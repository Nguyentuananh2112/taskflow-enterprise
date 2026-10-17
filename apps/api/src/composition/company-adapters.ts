import type { ICompanyAccessEvents } from '../modules/company/application/ports/access-events.port';
import type { IOffboardLeavePort } from '../modules/company/application/ports/offboard-leave.port';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import type { LateBoundRealtime } from './late-realtime';

// Adapter nối module company (Mốc 3.5) với notifications / realtime / leave qua port do company sở hữu (ADR-093).

/**
 * TẠM (T-061a): leave chưa được nối trên nhánh tích hợp (`tsconfig.exclusions.json`) ⇒ dọn đơn khi đóng nhiệm kỳ không
 * làm gì; D thay bằng `EmploymentLeaveHooks.offboardCleanup` ở T-064 (cổng gộp đòi danh sách loại rỗng).
 */
export const noOffboardLeave: IOffboardLeavePort = {
  offboardCleanup: () => Promise.resolve({ cancelled: 0, revoked: 0 }),
};

/**
 * Đổi role / grant công ty (T-061a): thông báo bền `ACCESS_CHANGED` (cùng transaction, refId = userId) + realtime
 * `company:access-changed` sau commit. `notifications` đọc trễ — module company dựng TRƯỚC notifications.
 */
/** Hai phụ thuộc admin của module company (T-061a) — gom để container gọn. */
export function companyAdminDeps(
  notifications: () => Pick<NotificationsModule, 'publisher'>,
  realtime: Pick<LateBoundRealtime, 'notifyCompanyAccessChanged'>,
): { offboardLeave: IOffboardLeavePort; accessEvents: ICompanyAccessEvents } {
  return {
    offboardLeave: noOffboardLeave,
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
