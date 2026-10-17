import type { RequestHandler } from 'express';

import type { IClock, IIdGenerator } from '../core/domain';
import type { HttpResponder } from '../core/http/envelope';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import type { AuthModule } from '../modules/auth/auth.module';
import type { IWorkCalendarPort } from '../modules/leave/application/ports/leave.ports';
import { createLeaveModule } from '../modules/leave/leave.module';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import {
  leaveAudit,
  leaveCompanyFrom,
  type CompanyPortsForLeave,
  type HrAuditWriterForLeave,
} from './leave-adapters';
import { leaveNotifierFrom } from './notification-adapters';
import type { Persistence } from './persistence';

export type LeaveModule = ReturnType<typeof createLeaveModule>;

/**
 * `ApprovedLeavePort` của attendance trỏ TRỄ sang leave: attendance cần ngày nghỉ đã duyệt, leave cần lịch của
 * attendance ⇒ tạo attendance trước với đối tượng này, gắn leave sau (`bind`). Attendance chỉ gọi port khi xử lý
 * request, không gọi lúc khởi tạo (A). Không import attendance (vẫn loại tạm tới T-063): `ApprovedLeavePort` của
 * attendance khớp THEO CẤU TRÚC, tsc kiểm lúc container truyền đối tượng này vào attendance.
 */
export class LateApprovedLeaves {
  #leave: LeaveModule | undefined;

  bind(leave: LeaveModule): LeaveModule {
    this.#leave = leave;
    return leave;
  }

  approvedLeaves(q: Parameters<LeaveModule['approvedLeaves']['approvedLeaves']>[0]) {
    if (!this.#leave) throw new Error('leave module chưa được tạo');
    return this.#leave.approvedLeaves.approvedLeaves(q);
  }
}

/**
 * Module leave (T-039/T-064) với adapter thật: lịch ← attendance, quyền / nhân viên / nhiệm kỳ + audit ← company
 * (T-061), thông báo ← notifications, tên ← reader user của task/auth.
 */
export function wireLeave(
  d: {
    persistence: Pick<Persistence, 'leave' | 'task' | 'uow'>;
    clock: IClock;
    ids: IIdGenerator;
  },
  m: {
    company: () => CompanyPortsForLeave;
    hrAudit: () => HrAuditWriterForLeave;
    attendance: { workCalendar: IWorkCalendarPort };
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
    company: leaveCompanyFrom(m.company),
    audit: leaveAudit(m.hrAudit),
    uow: d.persistence.uow,
    clock: d.clock,
    ids: d.ids,
    responder: http.responder,
    http: { authenticate: m.auth.authenticate, limit: http.limit },
  });
}
