import type { RequestHandler } from 'express';

import type { IClock, IIdGenerator } from '../core/domain';
import type { HttpResponder } from '../core/http/envelope';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import type { AuthModule } from '../modules/auth/auth.module';
import type {
  ILeaveHireDates,
  IWorkCalendarPort,
} from '../modules/leave/application/ports/leave.ports';
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
import type { ExportLimits } from '../core/export/export-limits';
import type { ExportSlots } from '../core/export/export-slots';
import { FflateXlsxWriter } from '../core/export/xlsx/xlsx-writer';
import type { ILogger } from '../core/logging/logger';

export type LeaveModule = ReturnType<typeof createLeaveModule>;

/**
 * Module leave (T-039/T-064) với adapter thật: lịch ← attendance, quyền / nhân viên / nhiệm kỳ + audit ← company
 * (T-061), thông báo ← notifications, tên ← reader user của task/auth.
 */
const NO_HIRE_DATES: ILeaveHireDates = {
  hireDateOf: () => Promise.resolve(null),
  hireDatesOf: () => Promise.resolve(new Map()),
};

export function wireLeave(
  d: {
    persistence: Pick<Persistence, 'leave' | 'task' | 'uow' | 'auth'>;
    clock: IClock;
    ids: IIdGenerator;
    logger: ILogger;
  },
  m: {
    company: () => CompanyPortsForLeave;
    hrAudit: () => HrAuditWriterForLeave;
    attendance: { workCalendar: IWorkCalendarPort };
    notifications: Pick<NotificationsModule, 'publisher'>;
    auth: Pick<AuthModule, 'authenticate'>;
    hireDates?: ILeaveHireDates;
    /** Một bộ suất cho MỌI export của công ty (bảng công, phép, lương) — container tạo. */
    exportSlots: ExportSlots;
    /** Trần / nhịp đọc (T-055, `config.exportLimits`) — thiếu ⇒ DEFAULT_EXPORT_LIMITS. */
    exportLimits?: ExportLimits | undefined;
  },
  http: { responder: HttpResponder; limit: (rules: readonly RateLimitRule[]) => RequestHandler[] },
): LeaveModule {
  return createLeaveModule({
    ...d.persistence.leave,
    users: d.persistence.task.users,
    // T-075: đồng ý xử lý lý do nghỉ ← cột `users` (auth).
    reasonConsent: d.persistence.auth.privacy,
    calendar: m.attendance.workCalendar,
    notifier: leaveNotifierFrom(m.notifications.publisher),
    company: leaveCompanyFrom(m.company),
    // Ngày vào công ty: hồ sơ của T-054 (B) — chưa nối ⇒ null cho mọi người (phép = annual, cờ thiếu ngày vào).
    hireDates: m.hireDates ?? NO_HIRE_DATES,
    spreadsheet: new FflateXlsxWriter(),
    readSnapshot: d.persistence.uow.snapshot,
    exportSlots: m.exportSlots,
    exportLimits: m.exportLimits,
    logger: d.logger,
    audit: leaveAudit(m.hrAudit),
    uow: d.persistence.uow,
    clock: d.clock,
    ids: d.ids,
    responder: http.responder,
    http: { authenticate: m.auth.authenticate, limit: http.limit },
  });
}
