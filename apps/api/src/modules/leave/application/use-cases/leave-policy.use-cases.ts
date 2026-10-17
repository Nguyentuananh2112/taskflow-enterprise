import type {
  LeavePolicyDto,
  LeavePolicyFields,
  NegativeBalanceDto,
  PutLeavePolicyResponse,
} from '@taskflow/contracts';

import { BusinessRuleViolationError, VersionConflictError } from '../../../../core/errors';
import { halfDaysFromDecimal, halfDaysToDecimal } from '../../domain/leave-balance';
import { resolvePolicy, type LeavePolicy } from '../../domain/leave-policy';
import { refOf } from '../leave-dto';
import {
  PERMISSION_HR_MANAGE,
  countingTenure,
  yearOf,
  type LeaveKit,
  type LeaveScope,
} from '../leave-kit';
import type { ILeaveEmployeeDirectory, ILeaveReadModel } from '../ports/leave-read-model.port';
import type { LeavePolicyRow } from '../ports/leave.ports';

// GET / PUT leave/policy (T-057, hr-extended.md ADR-131). Một bộ chính sách mỗi năm cho cả công ty; HR sửa năm hiện
// tại và năm sau, năm đã qua chỉ đọc (422 POLICY_YEAR_LOCKED). PUT lấy `taskflow:leave-policy` EXCLUSIVE (bậc 1) rồi
// mới chốt ghi HR (row, bậc 5) ⇒ không đơn nào được kiểm theo chính sách lẫn lộn.

const fromFields = (f: LeavePolicyFields): LeavePolicy => ({
  annual: halfDaysFromDecimal(f.annualDays),
  seniorityStepYears: f.seniorityStepYears,
  seniorityBonus: halfDaysFromDecimal(f.seniorityBonusDays),
  carryOverEnabled: f.carryOverEnabled,
  carryOverMax: halfDaysFromDecimal(f.carryOverMaxDays),
  carryOverExpiryMonth: f.carryOverExpiryMonth,
});

const toFields = (p: LeavePolicy): LeavePolicyFields => ({
  annualDays: halfDaysToDecimal(p.annual),
  seniorityStepYears: p.seniorityStepYears,
  seniorityBonusDays: halfDaysToDecimal(p.seniorityBonus),
  carryOverEnabled: p.carryOverEnabled,
  carryOverMaxDays: halfDaysToDecimal(p.carryOverMax),
  carryOverExpiryMonth: p.carryOverExpiryMonth,
});

const editableYears = (currentYear: number) => [currentYear, currentYear + 1];

async function policyDto(
  kit: LeaveKit,
  rows: readonly LeavePolicyRow[],
  year: number,
  currentYear: number,
): Promise<LeavePolicyDto> {
  const resolved = resolvePolicy(rows, year);
  const own = rows.find((r) => r.year === year);
  const refs = own ? await kit.d.users.findRefs([own.updatedById]) : new Map();
  return {
    ...toFields(resolved.policy),
    year,
    source: resolved.source,
    inheritedFromYear: resolved.source === 'INHERITED' ? resolved.fromYear : null,
    version: own?.version ?? 0,
    editable: editableYears(currentYear).includes(year),
    updatedAt: own?.updatedAt.toISOString() ?? null,
    updatedBy: own ? refOf(refs, own.updatedById) : null,
  };
}

export class GetLeavePolicyQuery {
  constructor(private readonly kit: LeaveKit) {}

  async execute(scope: LeaveScope, year: number): Promise<LeavePolicyDto> {
    await this.kit.requireActor(scope.actorId, PERMISSION_HR_MANAGE);
    const [rows, today] = await Promise.all([this.kit.d.policies.list(), this.kit.today()]);
    return policyDto(this.kit, rows, year, yearOf(today));
  }
}

export class PutLeavePolicyUseCase {
  constructor(
    private readonly kit: LeaveKit,
    private readonly readModel: ILeaveReadModel,
    private readonly employees: ILeaveEmployeeDirectory,
  ) {}

  async execute(
    scope: LeaveScope,
    year: number,
    body: LeavePolicyFields & { expectedVersion: number; reason?: string | null | undefined },
  ): Promise<PutLeavePolicyResponse> {
    const d = this.kit.d;
    const today = await this.kit.today();
    const currentYear = yearOf(today);
    const note = body.reason?.trim() ? body.reason.trim() : null;
    return d.uow.run(async () => {
      await d.policies.lock('exclusive'); // bậc 1 — TRƯỚC chốt ghi HR (row, bậc 5)
      await d.company.authorizeHrWrite({
        actorId: scope.actorId,
        targetUserId: null,
        reason: note,
      });
      if (!editableYears(currentYear).includes(year)) {
        throw new BusinessRuleViolationError(
          'POLICY_YEAR_LOCKED',
          'Chỉ sửa được chính sách phép năm hiện tại và năm sau.',
          { year, editableYears: editableYears(currentYear) },
        );
      }
      const rows = await d.policies.list();
      const before = resolvePolicy(rows, year).policy;
      const policy = fromFields(body);
      const saved = await d.policies.put({
        year,
        policy,
        expectedVersion: body.expectedVersion,
        updatedById: scope.actorId,
        at: d.clock.now(),
      });
      if (!saved) {
        const current = await policyDto(this.kit, rows, year, currentYear);
        throw new VersionConflictError(current.version, current);
      }
      await d.audit.record({
        actorId: scope.actorId,
        action: 'POLICY_SET',
        targetUserId: null,
        refId: null,
        before: { year, ...toFields(before) },
        after: { year, ...toFields(policy) },
        note,
      });
      const after = await d.policies.list();
      return {
        policy: await policyDto(this.kit, after, year, currentYear),
        // Chỉ năm HIỆN TẠI có đơn đã duyệt bị ảnh hưởng; năm sau chưa bắt đầu ⇒ không cảnh báo.
        negativeBalances: year === currentYear ? await this.negativeBalances(year, today) : [],
      };
    });
  }

  /** Nhân viên hiện tại có còn lại < 0 theo chính sách MỚI (ADR-131: cảnh báo, không tự thu hồi đơn). */
  private async negativeBalances(year: number, today: string): Promise<NegativeBalanceDto[]> {
    const calc = this.kit.readCalculator(this.readModel);
    const out: NegativeBalanceDto[] = [];
    let after: { fullName: string; id: string } | null = null;
    for (;;) {
      const page = await this.employees.listEmployees(after, 200);
      for (const user of page) {
        const view = await calc.compute({
          userId: user.id,
          year,
          today,
          tenure: countingTenure(await this.kit.d.company.employmentOf(user.id)),
        });
        if (view.balance.remaining < 0) {
          out.push({
            userId: user.id,
            user,
            remainingDays: halfDaysToDecimal(view.balance.remaining),
          });
        }
      }
      if (page.length < 200) return out;
      after = page.at(-1)!;
    }
  }
}
