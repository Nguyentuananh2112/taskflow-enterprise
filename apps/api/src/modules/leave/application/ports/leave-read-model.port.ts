import type { UserRefDto } from '@taskflow/contracts';

import type { CalendarDate } from '../../domain/leave-days';
import type { LeaveType } from '../../domain/leave-balance';
import type { LeaveStatus } from '../../domain/leave-status';
import type { LeaveBalanceRecord, LeaveRequestRecord } from './leave.ports';

/** Phía đọc leave (CQRS-lite, ADR-015) — phạm vi công ty (company-level.md ADR-136). */
export interface LeaveListFilter {
  readonly userId?: string;
  readonly status?: LeaveStatus;
}

/** Khóa keyset "mới nhất trước": (createdAt desc, id desc). */
export interface LeaveListKey {
  readonly createdAt: string;
  readonly id: string;
}

export interface ILeaveReadModel {
  /** Tối đa `limit` đơn, sắp (createdAt, id) giảm dần, sau `after` (không gồm `after`). */
  listRequests(
    filter: LeaveListFilter,
    after: LeaveListKey | null,
    limit: number,
  ): Promise<LeaveRequestRecord[]>;
  /** Đơn APPROVED có ít nhất một ngày trong [from, to]; `userIds` bỏ trống = cả công ty. */
  listApproved(q: {
    userIds?: readonly string[] | undefined;
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<LeaveRequestRecord[]>;
  /** Số dư đã lưu của nhiều người cùng năm (danh sách HR) — người chưa có dòng không có trong map. */
  findBalances(
    userIds: readonly string[],
    year: number,
  ): Promise<ReadonlyMap<string, LeaveBalanceRecord>>;
  /** Đơn PENDING/APPROVED có `startDate` trong `year` của nhiều người (như `listHolding`, một truy vấn). */
  listHoldingFor(userIds: readonly string[], year: number): Promise<LeaveRequestRecord[]>;
  /**
   * Tóm tắt đơn cho module thông báo (T-040b — notifications không đọc bảng của leave), theo id đơn. CHỈ loại +
   * ngày — KHÔNG `reason` (B-H2). Một truy vấn cho cả danh sách.
   */
  leaveSummaries(refIds: readonly string[]): Promise<ReadonlyMap<string, LeaveSummary>>;
  /** Số dư đã lưu — KHÔNG tạo (GET không ghi); chưa có ⇒ `null` (bên gọi dùng mặc định 12 ngày). */
  findBalance(userId: string, year: number): Promise<LeaveBalanceRecord | null>;
}

/** Tên hiển thị (`user`, `decidedBy`) — adapter của auth nối ở composition root, như `IUserRefReader` của attendance. */
export interface ILeaveUserRefs {
  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, UserRefDto>>;
}

export interface LeaveSummary {
  readonly type: LeaveType;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
}

/** Khóa keyset danh sách nhân viên: (fullName, id) tăng dần. */
export interface EmployeeKey {
  readonly fullName: string;
  readonly id: string;
}

/**
 * Nhân viên HIỆN TẠI của công ty (`company_members.role = EMPLOYEE` — đang làm, chờ kích hoạt, sắp nghỉ; D M3), sắp
 * theo tên rồi id. Dùng cho `GET leave/balances?year=` (HR): mọi nhân viên kể cả chưa có dòng số dư. Admin không có.
 */
export interface ILeaveEmployeeDirectory {
  listEmployees(after: EmployeeKey | null, limit: number): Promise<UserRefDto[]>;
}
