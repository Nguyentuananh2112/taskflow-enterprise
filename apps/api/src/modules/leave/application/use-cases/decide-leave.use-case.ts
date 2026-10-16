import { countLeaveHalfDays } from '../../domain/leave-days';
import { LeaveConflictError, LeaveNotFoundError } from '../../domain/leave-errors';
import { nextLeaveStatus, type LeaveAction } from '../../domain/leave-status';
import { toLeaveDto, type LeaveRequestDto } from '../leave-dto';
import {
  PERMISSION_HR_MANAGE,
  auditView,
  yearOf,
  type LeaveKit,
  type LeaveScope,
} from '../leave-kit';
import type { LeaveNotificationType, LeaveRequestRecord } from '../ports/leave.ports';

export type HrLeaveAction = Extract<LeaveAction, 'approve' | 'reject' | 'revoke'>;

const NOTIFICATION: Record<HrLeaveAction, LeaveNotificationType> = {
  approve: 'LEAVE_APPROVED',
  reject: 'LEAVE_REJECTED',
  revoke: 'LEAVE_REVOKED',
};

/**
 * HR duyệt / từ chối / thu hồi (thiết kế §9, test-spec LV-08..14, 19..25). Thứ tự: thiếu quyền 403 TRƯỚC id đơn
 * 404 (§0.3) → khóa (ws, người gửi) → đọc lại quyền (B-H3) → không tự xử lý (B-H1) → version → chuyển trạng thái
 * → (approve) người gửi còn là thành viên + số dư trong khóa (D-H2, D-M4).
 */
export class DecideLeaveUseCase {
  constructor(private readonly kit: LeaveKit) {}

  async execute(
    scope: LeaveScope,
    input: {
      requestId: string;
      expectedVersion: number;
      action: HrLeaveAction;
      note: string | null;
    },
  ): Promise<LeaveRequestDto> {
    const { workspaceId, actorId } = scope;
    const { requestId, expectedVersion, action, note } = input;
    const d = this.kit.d;
    if (action === 'revoke') this.kit.requireNote(note, 'Thu hồi đơn đã duyệt phải có lý do.');
    await this.kit.requireActor(workspaceId, actorId, PERMISSION_HR_MANAGE);
    const found = await d.requests.find(workspaceId, requestId);
    if (!found) throw new LeaveNotFoundError();

    return d.uow.run(async () => {
      await d.requests.lockUser(workspaceId, found.userId);
      const actor = await this.kit.requireActor(workspaceId, actorId, PERMISSION_HR_MANAGE); // B-H3: sau khóa
      this.kit.assertNotSelf(actor, found.userId, note);
      const record = await this.kit.reload(workspaceId, requestId, expectedVersion);

      const today = await this.kit.today(workspaceId);
      const to = nextLeaveStatus(record.status, action, { startDate: record.startDate, today });
      const year = yearOf(record.startDate);
      const calendar = await this.kit.yearCalendar(workspaceId, year);
      const halfDays = countLeaveHalfDays(record, calendar);

      if (action === 'approve') {
        if (!(await d.membership.isEligibleRequester(workspaceId, record.userId))) {
          throw new LeaveConflictError(
            'requester_not_member',
            {},
            'Người gửi không còn là thành viên — chỉ có thể từ chối đơn.',
          );
        }
        await this.kit.assertBalance({
          workspaceId,
          userId: record.userId,
          year,
          type: record.type,
          requested: halfDays,
          holding: await d.requests.listHolding(workspaceId, record.userId, year),
          calendar,
          excludeId: record.id,
        });
      }

      const now = d.clock.now();
      const next: LeaveRequestRecord = {
        ...record,
        status: to,
        decidedBy: actorId,
        decidedAt: now,
        decisionNote: note,
        version: record.version + 1,
        updatedAt: now,
      };
      await this.kit.save(next, record, halfDays);
      await d.audit.record({
        workspaceId,
        actorId,
        action: action === 'revoke' ? 'LEAVE_REVOKE' : 'LEAVE_DECIDE',
        targetUserId: record.userId,
        refId: record.id,
        before: auditView(record),
        after: auditView(next),
        note,
      });
      await d.notifier.notify({
        workspaceId,
        type: NOTIFICATION[action],
        requestId: record.id,
        actorId,
        recipient: { kind: 'user', userId: record.userId },
      });
      return toLeaveDto(next, halfDays, { includeReason: true });
    });
  }
}
