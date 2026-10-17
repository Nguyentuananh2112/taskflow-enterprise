import type { IOffboardLeavePort } from './offboard-leave.port';
import type { IWorkspaceExitPort } from './workspace-exit.port';

/** Nhận lại / cảnh báo lịch nghỉ — module leave hiện thực (`EmploymentLeaveHooks`). Gọi TRONG transaction. */
export interface IRehireLeavePort {
  /** Nhận lại cùng năm (D H2): `adjustmentDays` năm `year` về 0 (audit). */
  resetOnRehire(input: { userId: string; year: number; actorId: string }): Promise<boolean>;
  /** Số đơn PENDING (mọi năm) — cảnh báo ở response lên lịch nghỉ. */
  pendingCount(userId: string): Promise<number>;
}

export type CompanyNotificationType = 'OFFBOARD_SCHEDULED' | 'ACCESS_CHANGED';

/** Thông báo bền (ADR-123) — publisher của notifications; ghi TRONG transaction của bên gọi. */
export interface ICompanyNotifier {
  notify(input: {
    type: CompanyNotificationType;
    /** userId của người được tác động. */
    refId: string;
    actorId: string;
    recipient: { kind: 'user'; userId: string };
  }): Promise<void>;
}

/** Realtime sau commit — `company:access-changed` tới `user:{id}`; `disconnectUser` do auth làm. */
export interface ICompanyRealtime {
  notifyCompanyAccessChanged(
    input: {
      userId: string;
      role: 'ADMIN' | 'EMPLOYEE';
      grants: readonly ('HR_MANAGE' | 'PAYROLL_MANAGE')[];
    },
    meta: { actorId: string; originClientId?: string | null },
  ): Promise<void>;
}

/**
 * Cộng tác của vòng đời nhân viên — module khác tạo SAU company (workspace cần cổng công ty) ⇒ composition gán
 * `current` trước khi app nhận request (tham chiếu trễ, như `accounts`).
 */
export interface EmploymentCollaborators {
  workspaceExit: IWorkspaceExitPort;
  offboardLeave: IOffboardLeavePort;
  rehireLeave: IRehireLeavePort;
  notifier: ICompanyNotifier;
  realtime: ICompanyRealtime;
}
