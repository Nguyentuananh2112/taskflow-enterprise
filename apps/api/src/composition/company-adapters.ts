import type { CompanyModule, EmploymentCollaborators } from '../modules/company';
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
 * Đóng nhiệm kỳ (nghỉ việc / nâng Admin) còn hủy mọi đơn bổ sung giờ PENDING của người đó (hr-extended ADR-129, T-056) —
 * cùng transaction, SAU khi leave dọn đơn nghỉ; khóa `punch:<user>` đã do `lockEmployeeWork` của bên gọi giữ (ADR-136).
 */
/** `AttendanceModule.cancelPendingCorrections` (T-056). */
export interface CorrectionCleanup {
  cancelPendingCorrections(userId: string): Promise<number>;
}

export function withCorrectionCleanup(
  employment: IOffboardLeavePort & EmploymentCollaborators['rehireLeave'],
  attendance: CorrectionCleanup,
): IOffboardLeavePort & EmploymentCollaborators['rehireLeave'] {
  return {
    offboardCleanup: async (q) => {
      const done = await employment.offboardCleanup(q);
      await attendance.cancelPendingCorrections(q.userId);
      return done;
    },
    resetOnRehire: (q) => employment.resetOnRehire(q),
    pendingCount: (userId) => employment.pendingCount(userId),
  };
}

/**
 * Đổi role / grant công ty (T-061a): thông báo bền `ACCESS_CHANGED` (cùng transaction, refId = userId) + realtime
 * `company:access-changed` sau commit. `notifications` đọc trễ — module company dựng TRƯỚC notifications.
 */
/** Hai phụ thuộc admin của module company (T-061a) — gom để container gọn. */
export function companyAdminDeps(
  notifications: () => Pick<NotificationsModule, 'publisher'>,
  realtime: Pick<LateBoundRealtime, 'notifyCompanyAccessChanged'>,
  /** Leave + attendance (đơn bổ sung giờ) đọc trễ — dựng SAU company. */
  late: () => {
    employment: IOffboardLeavePort & EmploymentCollaborators['rehireLeave'];
    attendance: CorrectionCleanup;
  },
  adminWorkspaces: () => IAdminWorkspaces,
): {
  offboardLeave: IOffboardLeavePort;
  accessEvents: ICompanyAccessEvents;
  adminWorkspaces: () => IAdminWorkspaces;
} {
  return {
    adminWorkspaces,
    offboardLeave: offboardLeaveFrom(() =>
      withCorrectionCleanup(late().employment, late().attendance),
    ),
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

/**
 * Cổng công ty của workspace (HIGH-2): loadMembership / project:join chặn người đã nghỉ việc ĐÚNG giờ `access_until`;
 * thêm thành viên chỉ người chưa có lịch nghỉ (ADR-134).
 */
export function workspaceGate(company: Pick<CompanyModule, 'sessionGate' | 'members'>) {
  return {
    isActive: (userId: string) => company.sessionGate.isActive(userId),
    canJoinWorkspace: async (userId: string) =>
      (await company.members.find(userId))?.offboardLastDay === null,
  };
}

/** T-062: cộng tác vòng đời nhân viên — gọi trễ (module workspace / leave / notifications dựng SAU company). */
export function employmentCollaborators(m: {
  workspace: { exit: EmploymentCollaborators['workspaceExit'] };
  leave: {
    employment: EmploymentCollaborators['offboardLeave'] & EmploymentCollaborators['rehireLeave'];
  };
  attendance: CorrectionCleanup;
  notifications: Pick<NotificationsModule, 'publisher'>;
  realtime: Pick<LateBoundRealtime, 'notifyCompanyAccessChanged'>;
  hrProfile: {
    hire: EmploymentCollaborators['hireProfile'];
    columnsOf: EmploymentCollaborators['profileColumns']['columnsOf'];
  };
}): EmploymentCollaborators {
  return {
    workspaceExit: m.workspace.exit,
    offboardLeave: withCorrectionCleanup(m.leave.employment, m.attendance),
    rehireLeave: m.leave.employment,
    notifier: m.notifications.publisher,
    realtime: m.realtime,
    hireProfile: m.hrProfile.hire,
    profileColumns: { columnsOf: (userIds) => m.hrProfile.columnsOf(userIds) },
  };
}
