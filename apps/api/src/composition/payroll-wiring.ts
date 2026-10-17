import type { RequestHandler } from 'express';

import type { IClock, IIdGenerator } from '../core/domain';
import type { HttpResponder } from '../core/http/envelope';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import type { AttendanceModule } from '../modules/attendance/attendance.module';
import type { CompanyModule } from '../modules/company';
import type { HrProfileModule } from '../modules/hr-profile/hr-profile.module';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import { createPayrollModule, type PayrollModule } from '../modules/payroll/payroll.module';
import { wireHrProfile } from './hr-profile-wiring';
import type { Persistence } from './persistence';

/**
 * Module lương (Mốc 4, T-049) với adapter thật: quyền `payroll:manage` + luật self / tên công ty / audit PAYROLL_* ←
 * company, công + người trong kỳ ← attendance, `hireDate` ← hr-profile (ADR-128), thông báo ← notifications.
 */
export function wirePayroll(
  d: {
    persistence: Pick<Persistence, 'payroll' | 'task' | 'uow'>;
    clock: IClock;
    ids: IIdGenerator;
  },
  m: {
    company: Pick<CompanyModule, 'access' | 'permissionsOf' | 'hrAudit' | 'sessionGate'>;
    attendance: Pick<AttendanceModule, 'payroll' | 'timeZoneNow'>;
    hrProfile: Pick<HrProfileModule, 'hireDates'>;
    notifications: Pick<NotificationsModule, 'publisher'>;
  },
  http: { responder: HttpResponder; limit: (rules: readonly RateLimitRule[]) => RequestHandler[] },
): PayrollModule {
  return createPayrollModule({
    repos: d.persistence.payroll,
    access: {
      authorizeWrite: async (input) => {
        await m.company.access.authorizeWrite({ ...input, permission: 'payroll:manage' });
      },
    },
    hireDates: { hireDates: (q) => m.hrProfile.hireDates(q) },
    attendance: {
      payrollDaysFor: (q) => m.attendance.payroll.payrollDaysFor(q),
      payrollMembersOf: (period) => m.attendance.payroll.payrollMembersOf(period),
    },
    everEmployed: () => m.attendance.payroll.everEmployed(),
    users: d.persistence.task.users,
    audit: { record: (entry) => m.company.hrAudit.record(entry) },
    notifier: {
      notify: (input) => m.notifications.publisher.notify(input),
      notifyOnce: (input) => m.notifications.publisher.notifyOnce(input),
    },
    company: { companyName: () => m.company.sessionGate.companyName() },
    timeZoneNow: () => m.attendance.timeZoneNow(),
    permissionsOf: (userId) => m.company.permissionsOf(userId),
    uow: d.persistence.uow,
    clock: d.clock,
    ids: d.ids,
    ...http,
  });
}

/** Hồ sơ nhân viên + lương dựng cùng lúc (lương đọc `hireDate` của hồ sơ — ADR-128); gom để container gọn. */
export function wireProfileAndPayroll(
  d: Parameters<typeof wireHrProfile>[0] & Parameters<typeof wirePayroll>[0],
  m: Parameters<typeof wireHrProfile>[1] & Omit<Parameters<typeof wirePayroll>[1], 'hrProfile'>,
  http: Parameters<typeof wirePayroll>[2],
) {
  const hrProfile = wireHrProfile(d, m, http);
  const payroll = wirePayroll(d, { ...m, hrProfile }, http);
  return {
    hrProfile,
    payroll,
    routers: (authenticate: RequestHandler) => [
      ...hrProfile.routers(authenticate),
      ...payroll.routers(authenticate),
    ],
  };
}
