import type { ICompanyAccessEvents } from '../modules/company/application/ports/access-events.port';
import type { IAdminWorkspaces } from '../modules/company/application/ports/admin-workspaces.port';
import type { IOffboardLeavePort } from '../modules/company/application/ports/offboard-leave.port';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import type { LateBoundRealtime } from './late-realtime';

// Adapter nối module company (Mốc 3.5) với notifications / realtime / leave qua port do company sở hữu (ADR-093).

/**
 * Dọn đơn khi đóng nhiệm kỳ (nâng Admin — T-061a; nghỉ việc — T-062) ← `EmploymentLeaveHooks.offboardCleanup` của leave
 * (D, T-064). `employment` đọc trễ: leave dựng SAU company (leave cần lịch của attendance).
 */
export function offboardLeaveFrom(
  employment: () => Pick<IOffboardLeavePort, 'offboardCleanup'>,
): IOffboardLeavePort {
  return { offboardCleanup: (q) => employment().offboardCleanup(q) };
}

/**
 * Đổi role / grant công ty (T-061a): thông báo bền `ACCESS_CHANGED` (cùng transaction, refId = userId) + realtime
 * `company:access-changed` sau commit. `notifications` đọc trễ — module company dựng TRƯỚC notifications.
 */
/** Hai phụ thuộc admin của module company (T-061a) — gom để container gọn. */
export function companyAdminDeps(
  notifications: () => Pick<NotificationsModule, 'publisher'>,
  realtime: Pick<LateBoundRealtime, 'notifyCompanyAccessChanged'>,
  employment: () => Pick<IOffboardLeavePort, 'offboardCleanup'>,
  adminWorkspaces: () => IAdminWorkspaces,
): {
  offboardLeave: IOffboardLeavePort;
  accessEvents: ICompanyAccessEvents;
  adminWorkspaces: () => IAdminWorkspaces;
} {
  return {
    adminWorkspaces,
    offboardLeave: offboardLeaveFrom(employment),
    accessEvents: companyAccessEvents(notifications, realtime),
  };
}

export function companyAccessEvents(
  notifications: () => Pick<NotificationsModule, 'publisher'>,
  realtime: Pick<LateBoundRealtime, 'notifyCompanyAccessChanged'>,
): ICompanyAccessEvents {
  return {
    accessChanged: ({ userId, actorId }) =>
      notifications().publisher.notify({
        type: 'ACCESS_CHANGED',
        refId: userId,
        actorId,
        recipient: { kind: 'user', userId },
      }),
    pushAccessChanged: ({ userId, role, grants, actorId }) =>
      realtime.notifyCompanyAccessChanged({ userId, role, grants }, { actorId }),
  };
}
