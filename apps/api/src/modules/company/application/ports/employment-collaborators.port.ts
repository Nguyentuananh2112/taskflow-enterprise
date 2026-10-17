import type { LocalDate } from '../../../../core/domain/local-time';
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

/** Trường hồ sơ tùy chọn của `POST hr/employees` (T-054) — bỏ qua = giữ, `null` = xóa. */
export interface HireProfilePatch {
  hireDate?: LocalDate | null | undefined;
  department?: string | null | undefined;
  jobTitle?: string | null | undefined;
  workPhone?: string | null | undefined;
}

/**
 * Phần hồ sơ của thêm / nhận lại nhân viên — module hr-profile hiện thực (`HireProfileHooks`, ADR-128). Mọi lệnh
 * TRONG transaction thêm nhân viên (lỗi ⇒ không còn gì).
 */
export interface IHireProfilePort {
  wantsProfile(input: { patch: HireProfilePatch; keepHireDate?: boolean | undefined }): boolean;
  /** `taskflow:leave-policy` SHARED (bậc 1 ADR-136) — gọi ĐẦU TIÊN, trước `authorizeWrite`. */
  lockBeforeHire(): Promise<void>;
  /** 422 `HIRE_DATE_IN_FUTURE` khi `hireDate` ở tương lai (giờ nghiệp vụ). */
  validate(input: { patch: HireProfilePatch }, today: LocalDate): void;
  applyOnHire(input: {
    actorId: string;
    userId: string;
    rehire: boolean;
    patch: HireProfilePatch;
    keepHireDate?: boolean | undefined;
  }): Promise<void>;
}

/** Cột hồ sơ của `GET hr/employees` (T-054 — không có `workPhone`); người chưa có hồ sơ không có trong Map. */
export interface IProfileColumnsPort {
  columnsOf(
    userIds: readonly string[],
  ): Promise<
    ReadonlyMap<
      string,
      { hireDate: LocalDate | null; department: string | null; jobTitle: string | null }
    >
  >;
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
  /** Mốc 5 (T-054): module hr-profile. */
  hireProfile: IHireProfilePort;
  profileColumns: IProfileColumnsPort;
}
