import type { RequestHandler } from 'express';

import type { IClock, IIdGenerator } from '../core/domain';
import type { HttpResponder } from '../core/http/envelope';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import type { AuthModule } from '../modules/auth/auth.module';
import type { AttendanceModule } from '../modules/attendance/attendance.module';
import type { ApprovedLeavePort } from '../modules/attendance/application/ports/approved-leave.port';
import { createLeaveModule } from '../modules/leave/leave.module';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import type { WorkspaceModule } from '../modules/workspace/workspace.module';
import { leaveAudit, leaveMembership } from './leave-adapters';
import { leaveNotifierFrom } from './notification-adapters';
import type { Persistence } from './persistence';

export type LeaveModule = ReturnType<typeof createLeaveModule>;

/**
 * `ApprovedLeavePort` của attendance trỏ TRỄ sang leave: attendance cần ngày nghỉ đã duyệt, leave cần lịch của
 * attendance ⇒ tạo attendance trước với đối tượng này, gắn leave sau (`bind`). Attendance chỉ gọi port khi xử lý
 * request, không gọi lúc khởi tạo (A).
 */
export class LateApprovedLeaves implements ApprovedLeavePort {
  #leave: LeaveModule | undefined;

  bind(leave: LeaveModule): LeaveModule {
    this.#leave = leave;
    return leave;
  }

  approvedLeaves(q: Parameters<ApprovedLeavePort['approvedLeaves']>[0]) {
    if (!this.#leave) throw new Error('leave module chưa được tạo');
    return this.#leave.approvedLeaves.approvedLeaves(q);
  }
}

/**
 * Module leave (T-039) với adapter thật: lịch ← attendance (T-038), quyền / chốt ghi HR / audit ← workspace (T-037),
 * thông báo ← notifications (T-040), tên ← reader user của task/auth.
 */
export function wireLeave(
  d: {
    persistence: Pick<Persistence, 'leave' | 'task' | 'uow'>;
    clock: IClock;
    ids: IIdGenerator;
  },
  m: {
    workspace: WorkspaceModule;
    attendance: Pick<AttendanceModule, 'workCalendar'>;
    notifications: Pick<NotificationsModule, 'publisher'>;
    auth: Pick<AuthModule, 'authenticate'>;
  },
  http: { responder: HttpResponder; limit: (rules: readonly RateLimitRule[]) => RequestHandler[] },
): LeaveModule {
  return createLeaveModule({
    ...d.persistence.leave,
    users: d.persistence.task.users,
    calendar: m.attendance.workCalendar,
    notifier: leaveNotifierFrom(m.notifications.publisher),
    membership: leaveMembership(() => m.workspace),
    audit: leaveAudit(() => m.workspace),
    uow: d.persistence.uow,
    clock: d.clock,
    ids: d.ids,
    responder: http.responder,
    http: { authenticate: m.auth.authenticate, limit: http.limit },
  });
}
