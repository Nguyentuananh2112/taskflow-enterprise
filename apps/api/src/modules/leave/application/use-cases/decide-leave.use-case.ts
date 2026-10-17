import { ResourceNotFoundError } from '../../../../core/errors';
import { countLeaveHalfDays } from '../../domain/leave-days';
import { LeaveConflictError } from '../../domain/leave-errors';
import { nextLeaveStatus, type LeaveAction } from '../../domain/leave-status';
import { assertNotAfterLastDay } from '../../domain/leave-tenure';
import type { LeaveRequestDto } from '../leave-dto';
import {
  PERMISSION_HR_MANAGE,
  auditView,
  countingTenure,
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
 * HR duyệt / từ chối / thu hồi (attendance-leave §9, LV-08..14, 19..25; company-level ADR-136). Thứ tự: thiếu quyền
 * 403 TRƯỚC id đơn 404 → khóa `taskflow:leave:<người gửi>` → đọc lại quyền FOR SHARE (B-H3) + không tự xử lý
 * (tuyệt đối) → version → chuyển trạng thái → (approve) người gửi còn là nhân viên, `AFTER_LAST_DAY`, số dư theo
 * nhiệm kỳ trong khóa (D-H2, D-M4, D H1/H2).
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
    const { actorId } = scope;
    const { requestId, expectedVersion, action, note } = input;
    const d = this.kit.d;
    if (action === 'revoke') this.kit.requireNote(note, 'Thu hồi đơn đã duyệt phải có lý do.');
    await this.kit.requireActor(actorId, PERMISSION_HR_MANAGE);
    // Đọc NGOÀI transaction chỉ để biết khóa của AI: giả định `userId` của đơn BẤT BIẾN (không lệnh nào đổi chủ đơn) —
    // trạng thái / version đọc lại trong khóa (`reload`). Nếu sau này cho đổi chủ đơn thì phải khóa lại (B review LOW-2).
    const found = await d.requests.find(requestId);
    if (!found) throw new ResourceNotFoundError('leave_request');

    return d.uow.run(async () => {
      await this.kit.lockFor(found.userId); // policy SHARED → leave:<user> (ADR-131/136)
      // B-H3 + B-H1 sau khóa: đọc lại quyền (FOR SHARE, bậc 5) + luật tự xử lý — `ICompanyAccess.authorizeWrite`.
      await d.company.authorizeHrWrite({
        actorId,
        targetUserId: found.userId,
        reason: note,
      });
      const record = await this.kit.reload(requestId, expectedVersion);

      const today = await this.kit.today();
      const to = nextLeaveStatus(record.status, action, { startDate: record.startDate, today });
      const year = yearOf(record.startDate);
      const calendar = await this.kit.yearCalendar(year);
      const halfDays = countLeaveHalfDays(record, calendar);

      if (action === 'approve') {
        if (!(await d.company.isEmployee(record.userId))) {
          throw new LeaveConflictError(
            'requester_not_member',
            {},
            'Người gửi không còn là nhân viên — chỉ có thể từ chối đơn.',
          );
        }
        const employment = await d.company.employmentOf(record.userId);
        assertNotAfterLastDay(record, employment.lastDay);
        await this.kit.snapshotCarried(record.userId, year, today);
        // Đơn đang xét đã nằm trong `holding` (PENDING) ⇒ đếm đúng một lần (ADR-131).
        await this.kit.assertBalance({
          userId: record.userId,
          year,
          type: record.type,
          holding: await d.requests.listHolding(record.userId, year),
          tenure: countingTenure(employment),
          today,
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
      // Đơn năm Y đổi trạng thái khi Y+1 đã bắt đầu (duyệt muộn / thu hồi) ⇒ `carried(Y+1)` đã chụp phải tính lại.
      await this.kit.refreshNextCarried(record.userId, year, today);
      await d.audit.record({
        actorId,
        action: action === 'revoke' ? 'LEAVE_REVOKE' : 'LEAVE_DECIDE',
        targetUserId: record.userId,
        refId: record.id,
        before: auditView(record),
        after: auditView(next),
        note,
      });
      await d.notifier.notify({
        type: NOTIFICATION[action],
        requestId: record.id,
        actorId,
        recipient: { kind: 'user', userId: record.userId },
      });
      return this.kit.dto(next, halfDays);
    });
  }
}
