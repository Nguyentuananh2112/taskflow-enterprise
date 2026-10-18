import { periodLastDay } from '@taskflow/contracts/payroll';

import { BusinessRuleViolationError, ResourceConflictError } from '../../../../core/errors';
import { draftPayslip, todayOf, type PayrollDeps } from '../payroll-kit';
import type { PayrollRunRecord } from '../ports/payroll-store.port';
import { draftRun, freshKeep, recalculated, sourcesOf } from '../run-steps';

/**
 * Bảng lương tháng (payroll.md ADR-125/127, T-049): tạo nháp / tính lại công / thêm người. Mọi lệnh:
 * `authorizeWrite(payroll:manage)` → khóa `taskflow:payroll:<period>` → kiểm `status = DRAFT` TRONG khóa. Tạo nháp chỉ khi
 * tháng đã kết thúc (giờ nghiệp vụ); người trong kỳ = mọi đoạn nhiệm kỳ EMPLOYEE giao tháng. Phát hành:
 * `PublishPayrollUseCase`.
 */
export class PayrollRunsUseCases {
  constructor(private readonly d: PayrollDeps) {}

  /** `POST payroll/runs/:period` ⇒ `{ created }` (đã có ⇒ trả bảng cũ, idempotent). */
  async create(
    actorId: string,
    period: string,
  ): Promise<{ created: boolean; run: PayrollRunRecord }> {
    const { d } = this;
    if ((await todayOf(d)) <= periodLastDay(period)) {
      throw new BusinessRuleViolationError('PERIOD_NOT_ENDED', 'Tháng này chưa kết thúc.');
    }
    return d.uow.run(async () => {
      await d.access.authorizeWrite({ actorId });
      await d.store.lockPeriod(period);
      const existing = await d.store.findRun(period);
      if (existing) return { created: false, run: existing };
      const members = await d.attendance.payrollMembersOf(period);
      const src = await sourcesOf(d, period, members);
      const settings = await d.store.getSettings();
      const now = d.clock.now();
      const run: PayrollRunRecord = {
        id: d.ids.next(),
        period,
        status: 'DRAFT',
        standardDays: src.standardDays,
        seniorityPerYear: settings.seniorityPerYear,
        companyName: null,
        publishedAt: null,
        publishedById: null,
        createdById: actorId,
        createdAt: now,
      };
      await d.store.insertRun(run);
      for (const userId of members) {
        await d.store.insertPayslip(draftPayslip(run, userId, src, freshKeep(d, now), now));
      }
      await d.audit.record({
        actorId,
        action: 'PAYROLL_RUN_CREATE',
        refId: run.id,
        after: { period, payslips: members.length, standardDays: run.standardDays },
      });
      return { created: true, run };
    });
  }

  /** `POST …/recalculate/preview` — số phiếu sẽ đổi số, KHÔNG ghi. */
  async previewRecalculate(actorId: string, period: string): Promise<{ changedCount: number }> {
    const { d } = this;
    return d.uow.run(async () => {
      await d.access.authorizeWrite({ actorId });
      return { changedCount: (await recalculated(d, period)).changed.length };
    });
  }

  /** `POST …/recalculate` — giữ dòng / ghi chú / sửa công có lý do; cập nhật ảnh chụp S + mức thâm niên. */
  async recalculate(actorId: string, period: string): Promise<{ changedCount: number }> {
    const { d } = this;
    return d.uow.run(async () => {
      await d.access.authorizeWrite({ actorId });
      await d.store.lockPeriod(period);
      const { run, changed, standardDays, seniorityPerYear } = await recalculated(d, period);
      await d.store.updateDraftRun(run.id, { standardDays, seniorityPerYear });
      for (const { next, lockVersion } of changed) {
        if (!(await d.store.updateDraftPayslip(next, lockVersion))) {
          throw new ResourceConflictError(
            { reason: 'payslip_changed' },
            'Phiếu vừa được sửa — thử lại.',
          );
        }
      }
      await d.audit.record({
        actorId,
        action: 'PAYROLL_RECALCULATE',
        refId: run.id,
        after: { period, changed: changed.length, standardDays, seniorityPerYear },
      });
      return { changedCount: changed.length };
    });
  }

  /** `POST …/add-missing` — người có đoạn EMPLOYEE giao kỳ mà chưa có phiếu (vào muộn / nhận lại). */
  async addMissing(actorId: string, period: string): Promise<{ added: number }> {
    const { d } = this;
    return d.uow.run(async () => {
      await d.access.authorizeWrite({ actorId });
      await d.store.lockPeriod(period);
      const run = await draftRun(d, period);
      const have = new Set((await d.store.listCurrentPayslips(run.id)).map((p) => p.userId));
      const missing = (await d.attendance.payrollMembersOf(period)).filter((u) => !have.has(u));
      if (missing.length) {
        const src = await sourcesOf(d, period, missing);
        const now = d.clock.now();
        for (const userId of missing) {
          await d.store.insertPayslip(draftPayslip(run, userId, src, freshKeep(d, now), now));
        }
      }
      await d.audit.record({
        actorId,
        action: 'PAYROLL_ADD_MISSING',
        refId: run.id,
        after: { period, added: missing.length },
      });
      return { added: missing.length };
    });
  }
}
