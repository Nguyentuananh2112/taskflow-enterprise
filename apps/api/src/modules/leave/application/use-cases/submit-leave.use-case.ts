import { BusinessRuleViolationError } from '../../../../core/errors';
import type { LeaveType } from '../../domain/leave-balance';
import {
  assertLeaveRange,
  countLeaveHalfDays,
  overlaps,
  type CalendarDate,
  type LeaveDayPart,
} from '../../domain/leave-days';
import { LeaveConflictError } from '../../domain/leave-errors';
import { toLeaveDto, type LeaveRequestDto } from '../leave-dto';
import {
  PERMISSION_LEAVE_SELF,
  auditView,
  yearOf,
  type LeaveKit,
  type LeaveScope,
} from '../leave-kit';
import type { LeaveRequestRecord } from '../ports/leave.ports';

export interface SubmitLeaveInput {
  type: LeaveType;
  startDate: CalendarDate;
  endDate: CalendarDate;
  dayPart: LeaveDayPart;
  reason: string;
}

/** Gửi đơn (thiết kế §9 dòng "(mới) → PENDING", test-spec LV-01..07, LD-06..08). */
export class SubmitLeaveUseCase {
  constructor(private readonly kit: LeaveKit) {}

  async execute(scope: LeaveScope, input: SubmitLeaveInput): Promise<LeaveRequestDto> {
    assertLeaveRange(input); // hình dạng sai ⇒ 400/422 TRƯỚC khi khóa
    const { workspaceId, actorId } = scope;
    const d = this.kit.d;
    return d.uow.run(async () => {
      await d.requests.lockUser(workspaceId, actorId);
      await this.kit.requireActor(workspaceId, actorId, PERMISSION_LEAVE_SELF);

      const year = yearOf(input.startDate);
      const calendar = await this.kit.yearCalendar(workspaceId, year);
      const halfDays = countLeaveHalfDays(input, calendar);
      // LD-06 / D-M1: khoảng chỉ gồm ngày nghỉ / ngày lễ ⇒ không tạo đơn 0 ngày.
      if (halfDays === 0) {
        throw new BusinessRuleViolationError(
          'NO_WORKING_DAYS',
          'Khoảng nghỉ không có ngày làm việc nào.',
        );
      }

      const holding = await d.requests.listHolding(workspaceId, actorId, year);
      const clash = holding.find((r) => overlaps(r, input));
      if (clash) {
        throw new LeaveConflictError(
          'overlapping_leave',
          { requestId: clash.id },
          'Đã có đơn nghỉ trùng thời gian.',
        );
      }
      await this.kit.assertBalance({
        workspaceId,
        userId: actorId,
        year,
        type: input.type,
        requested: halfDays,
        holding,
        calendar,
      });

      const now = d.clock.now();
      const record: LeaveRequestRecord = {
        id: d.ids.next(),
        workspaceId,
        userId: actorId,
        ...input,
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
        workspaceId,
        actorId,
        action: 'LEAVE_SUBMIT',
        targetUserId: actorId,
        refId: record.id,
        before: null,
        after: auditView(record),
      });
      await d.notifier.notify({
        workspaceId,
        type: 'LEAVE_SUBMITTED',
        requestId: record.id,
        actorId,
        recipient: { kind: 'hr' },
      });
      return toLeaveDto(record, halfDays, { includeReason: true });
    });
  }
}
