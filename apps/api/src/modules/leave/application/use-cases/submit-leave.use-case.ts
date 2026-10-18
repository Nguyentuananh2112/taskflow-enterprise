import { BusinessRuleViolationError } from '../../../../core/errors';
import type { LeaveType } from '../../domain/leave-balance';
import {
  assertLeaveRange,
  countLeaveHalfDays,
  type CalendarDate,
  type LeaveDayPart,
} from '../../domain/leave-days';
import { assertNotAfterLastDay } from '../../domain/leave-tenure';
import type { LeaveRequestDto } from '../leave-dto';
import {
  PERMISSION_LEAVE_SELF,
  auditView,
  countingTenure,
  yearOf,
  type LeaveKit,
  type LeaveScope,
} from '../leave-kit';
import type { ILeaveReasonConsent, LeaveRequestRecord } from '../ports/leave.ports';
import { assertHasWorkingDays, assertNoOverlap } from './new-leave-checks';

export interface SubmitLeaveInput {
  type: LeaveType;
  startDate: CalendarDate;
  endDate: CalendarDate;
  dayPart: LeaveDayPart;
  /** Tùy chọn (TL): trim; rỗng ⇒ `null`. Độ dài ≤ 1000 kiểm ở schema contracts. */
  reason?: string | null | undefined;
}

export function normalizeReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Gửi đơn (attendance-leave §9 "(mới) → PENDING", LV-01..07, LD-06..08; company-level ADR-136): khóa
 * `taskflow:leave:<user>` → nhân viên còn hiệu lực SAU khóa (A C2) → `AFTER_LAST_DAY` (D H1) → đếm + số dư theo
 * nhiệm kỳ hiện tại (D H2).
 */
export class SubmitLeaveUseCase {
  constructor(
    private readonly kit: LeaveKit,
    private readonly reasonConsent: ILeaveReasonConsent,
  ) {}

  async execute(scope: LeaveScope, input: SubmitLeaveInput): Promise<LeaveRequestDto> {
    assertLeaveRange(input); // hình dạng sai ⇒ 400/422 TRƯỚC khi khóa
    const { actorId } = scope;
    const d = this.kit.d;
    return d.uow.run(async () => {
      await this.kit.lockFor(actorId); // policy SHARED → leave:<user> (ADR-131/136)
      await this.kit.requireActor(actorId, PERMISSION_LEAVE_SELF);
      await d.company.assertActiveEmployee(actorId);
      // T-075 (TL theo soát B): có lý do mà chưa đồng ý xử lý lý do nghỉ ⇒ 422 rule (sau 401 / 403).
      if (
        normalizeReason(input.reason) !== null &&
        !(await this.reasonConsent.hasLeaveReasonConsent(actorId))
      ) {
        throw new BusinessRuleViolationError(
          'LEAVE_REASON_CONSENT_REQUIRED',
          'Bạn chưa đồng ý để công ty xử lý lý do nghỉ — bỏ trống lý do hoặc đồng ý ở trang Quyền riêng tư.',
        );
      }
      const employment = await d.company.employmentOf(actorId);
      assertNotAfterLastDay(input, employment.lastDay);

      const year = yearOf(input.startDate);
      const calendar = await this.kit.yearCalendar(year);
      const halfDays = countLeaveHalfDays(input, calendar);
      assertHasWorkingDays(halfDays);

      const holding = await d.requests.listHolding(actorId, year);
      assertNoOverlap(holding, input);
      const today = await this.kit.today();
      await this.kit.snapshotCarried(actorId, year, today);
      await this.kit.assertBalance({
        userId: actorId,
        year,
        type: input.type,
        holding,
        tenure: countingTenure(employment),
        today,
        extra: input,
      });

      const now = d.clock.now();
      const record: LeaveRequestRecord = {
        id: d.ids.next(),
        userId: actorId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        dayPart: input.dayPart,
        reason: normalizeReason(input.reason),
        status: 'PENDING',
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await d.requests.add(record);
      await d.audit.record({
        actorId,
        action: 'LEAVE_SUBMIT',
        targetUserId: actorId,
        refId: record.id,
        before: null,
        after: auditView(record),
      });
      await d.notifier.notify({
        type: 'LEAVE_SUBMITTED',
        requestId: record.id,
        actorId,
        recipient: { kind: 'hr' },
      });
      return this.kit.dto(record, halfDays);
    });
  }
}
