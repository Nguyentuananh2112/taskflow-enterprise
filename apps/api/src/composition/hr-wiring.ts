import type { IClock, IIdGenerator } from '../core/domain';
import type { ExportLimits } from '../core/export/export-limits';
import type { ExportSlots } from '../core/export/export-slots';
import type { ILogger } from '../core/logging/logger';
import type { AuthModule } from '../modules/auth/auth.module';
import type { IWorkCalendarPort } from '../modules/leave/application/ports/leave.ports';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import { wireHrProfile } from './hr-profile-wiring';
import { wireLeave, type LeaveModule } from './leave-wiring';
import type { Persistence } from './persistence';

type ProfileCompany = Parameters<typeof wireHrProfile>[1]['company'];
type LeaveCompany = ReturnType<Parameters<typeof wireLeave>[1]['company']>;
type Http = Parameters<typeof wireLeave>[2];
type LeaveCompanyAudit = ReturnType<Parameters<typeof wireLeave>[1]['hrAudit']>;

/**
 * Nghỉ phép (T-064/T-057) + hồ sơ nhân viên (T-054) dựng CHUNG vì phụ thuộc vòng: leave cần ngày vào công ty
 * (hồ sơ — thâm niên phép, ADR-131), hồ sơ cần phép âm khi đổi `hireDate` (leave — ADR-128). Cả hai chiều là tham chiếu
 * trễ, chỉ đọc lúc chạy request (không gọi lúc khởi tạo).
 */
export function wireLeaveAndProfile(
  d: {
    persistence: Pick<Persistence, 'leave' | 'task' | 'uow' | 'hrProfile'>;
    clock: IClock;
    ids: IIdGenerator;
    logger: ILogger;
  },
  m: {
    company: ProfileCompany & Omit<LeaveCompany, 'clock'> & { hrAudit: LeaveCompanyAudit };
    attendance: { workCalendar: IWorkCalendarPort; timeZoneNow(): Promise<string> };
    notifications: Pick<NotificationsModule, 'publisher'>;
    auth: Pick<AuthModule, 'authenticate'>;
    exportSlots: ExportSlots;
    exportLimits?: ExportLimits | undefined;
  },
  http: Http,
): { leave: LeaveModule; hrProfile: ReturnType<typeof wireHrProfile> } {
  const ref: { profile?: ReturnType<typeof wireHrProfile> } = {};
  const leave = wireLeave(
    d,
    {
      company: () => ({ ...m.company, clock: d.clock }),
      hrAudit: () => m.company.hrAudit,
      attendance: m.attendance,
      notifications: m.notifications,
      auth: m.auth,
      exportSlots: m.exportSlots,
      exportLimits: m.exportLimits,
      hireDates: {
        hireDateOf: async (userId) => {
          if (!ref.profile) throw new Error('hr-profile chưa được dựng');
          return (await ref.profile.hireDates({ userIds: [userId] })).get(userId) ?? null;
        },
        // T-057d: một truy vấn cho cả trang số dư / báo cáo (không N+1).
        hireDatesOf: (userIds) => {
          if (!ref.profile) throw new Error('hr-profile chưa được dựng');
          return ref.profile.hireDates({ userIds });
        },
      },
    },
    http,
  );
  const profile = wireHrProfile(
    d,
    {
      company: m.company,
      notifications: m.notifications,
      timeZone: () => m.attendance.timeZoneNow(),
      leaveBalances: () => leave.employment,
    },
    http,
  );
  ref.profile = profile;
  return { leave, hrProfile: profile };
}
