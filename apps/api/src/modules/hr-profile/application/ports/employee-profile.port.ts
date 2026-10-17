import type { LocalDate } from '../../../../core/domain/local-time';
import type { EmployeeProfileSnapshot, ProfileFields } from '../../domain/employee-profile';

/** Bảng `employee_profiles` (ADR-128). Gọi TRONG transaction của bên gọi. */
export interface IEmployeeProfileRepository {
  find(userId: string): Promise<EmployeeProfileSnapshot | null>;
  /** `SELECT … FOR UPDATE` — lệnh ghi đọc dưới khóa dòng (retention D8 `SKIP LOCKED` bỏ qua dòng đang sửa). */
  findForUpdate(userId: string): Promise<EmployeeProfileSnapshot | null>;
  /** Một truy vấn; người chưa có hồ sơ không có trong Map; `[]` ⇒ Map rỗng. */
  findMany(userIds: readonly string[]): Promise<ReadonlyMap<string, EmployeeProfileSnapshot>>;
  /**
   * `expectedVersion = 0` ⇒ INSERT (đã có dòng ⇒ `null`); khác 0 ⇒ UPDATE khi `version` khớp, `version + 1`
   * (lệch / không có dòng ⇒ `null`).
   */
  save(input: {
    userId: string;
    fields: ProfileFields;
    expectedVersion: number;
    updatedById: string;
    at: Date;
  }): Promise<EmployeeProfileSnapshot | null>;
  /** Phòng ban / chức vụ đã dùng trong công ty — không trùng, sắp theo chữ cái. */
  suggestions(): Promise<{ departments: string[]; jobTitles: string[] }>;
}

/**
 * Khóa của bảng ADR-136 cho lệnh đụng `hireDate` (ADR-128/131): `taskflow:leave-policy` SHARED (bậc 1) RỒI
 * `taskflow:leave:<user>` (bậc 3) — đều TRƯỚC khóa dòng `company_members` (bậc 5). Cùng chuỗi + hàm băm với leave.
 */
export interface IProfileLocks {
  lockLeavePolicyShared(): Promise<void>;
  lockLeave(userId: string): Promise<void>;
}

export type ProfilePersonStatus = 'ACTIVE' | 'PENDING_ACTIVATION' | 'OFFBOARDING' | 'LEFT';

/** Người từng có nhiệm kỳ EMPLOYEE (module company — khớp cấu trúc). `null` = chưa từng ⇒ 404 `user`. */
export interface IProfilePeople {
  employeeRef(userId: string): Promise<{ fullName: string; status: ProfilePersonStatus } | null>;
}

/** Quyền + luật self của module company (`CompanyAccess`, `permissionsOf` — khớp cấu trúc). */
export interface IProfileAccess {
  authorizeWrite(input: { actorId: string; targetUserId: string }): Promise<{ userId: string }>;
  permissionsOf(userId: string): Promise<ReadonlySet<string> | null>;
}

/** `HrAuditWriter` của company (khớp cấu trúc) — ghi cùng transaction. */
export interface IProfileAudit {
  record(input: {
    actorId: string;
    action: 'PROFILE_SET';
    targetUserId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
  }): Promise<void>;
}

/** Publisher của notifications — `PROFILE_UPDATED`, refId = userId, không mang giá trị hồ sơ. */
export interface IProfileNotifier {
  notify(input: {
    type: 'PROFILE_UPDATED';
    refId: string;
    actorId: string;
    recipient: { kind: 'user'; userId: string };
  }): Promise<void>;
}

/**
 * Phép âm nếu đổi `hireDate` (leave — D T-057, `leave.employment.negativeBalancesIfHireDate`): chỉ đọc, năm nay +
 * năm sau theo `hireDate` MỚI, chỉ năm `remainingDays < 0`. Gọi SAU `IProfileLocks` (port không tự khóa).
 */
export interface IProfileLeaveBalances {
  negativeBalancesIfHireDate(input: {
    userId: string;
    hireDate: LocalDate | null;
  }): Promise<{ year: number; remainingDays: number }[]>;
}
