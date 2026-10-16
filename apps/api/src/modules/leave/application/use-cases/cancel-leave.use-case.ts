import { ResourceNotFoundError } from '../../../../core/errors';
import { countLeaveHalfDays } from '../../domain/leave-days';
import { nextLeaveStatus } from '../../domain/leave-status';
import { toLeaveDto, type LeaveRequestDto } from '../leave-dto';
import {
  PERMISSION_LEAVE_SELF,
  auditView,
  yearOf,
  type LeaveKit,
  type LeaveScope,
} from '../leave-kit';
import type { LeaveRequestRecord } from '../ports/leave.ports';

/**
 * Người gửi hủy đơn (thiết kế §9: PENDING → CANCELLED; APPROVED → CANCELLED khi `startDate` > hôm nay theo
 * múi giờ lịch). Đơn của người khác ⇒ 404 như không tồn tại (LV-16, không lộ id) — kiểm TRƯỚC khi khóa.
 */
export class CancelLeaveUseCase {
  constructor(private readonly kit: LeaveKit) {}

  async execute(
    scope: LeaveScope,
    input: { requestId: string; expectedVersion: number },
  ): Promise<LeaveRequestDto> {
    const { workspaceId, actorId } = scope;
    const d = this.kit.d;
    const found = await d.requests.find(workspaceId, input.requestId);
    if (!found || found.userId !== actorId) throw new ResourceNotFoundError('leave_request');

    return d.uow.run(async () => {
      await d.requests.lockUser(workspaceId, actorId);
      await this.kit.requireActor(workspaceId, actorId, PERMISSION_LEAVE_SELF);
      const record = await this.kit.reload(workspaceId, input.requestId, input.expectedVersion);
      const today = await this.kit.today(workspaceId);
      const to = nextLeaveStatus(record.status, 'cancel', { startDate: record.startDate, today });
      const halfDays = countLeaveHalfDays(
        record,
        await this.kit.yearCalendar(workspaceId, yearOf(record.startDate)),
      );

      const next: LeaveRequestRecord = {
        ...record,
        status: to,
        version: record.version + 1,
        updatedAt: d.clock.now(),
      };
      await this.kit.save(next, record, halfDays);
      await d.audit.record({
        workspaceId,
        actorId,
        action: 'LEAVE_CANCEL',
        targetUserId: actorId,
        refId: record.id,
        before: auditView(record),
        after: auditView(next),
      });
      await d.notifier.notify({
        workspaceId,
        type: 'LEAVE_CANCELLED',
        requestId: record.id,
        actorId,
        recipient: { kind: 'hr' },
      });
      return toLeaveDto(next, halfDays, { includeReason: true });
    });
  }
}
