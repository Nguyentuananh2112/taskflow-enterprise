import type { UserRefDto } from '@taskflow/contracts';

import type { CalendarDate } from '../../domain/leave-days';
import type { LeaveStatus } from '../../domain/leave-status';
import type { LeaveBalanceRecord, LeaveRequestRecord } from './leave.ports';

/** Phía đọc leave (CQRS-lite, ADR-015). Mọi truy vấn có `workspaceId` (tenant). */
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
    workspaceId: string,
    filter: LeaveListFilter,
    after: LeaveListKey | null,
    limit: number,
  ): Promise<LeaveRequestRecord[]>;
  /** Đơn APPROVED có ít nhất một ngày trong [from, to]; `userIds` bỏ trống = cả workspace. */
  listApproved(q: {
    workspaceId: string;
    userIds?: readonly string[] | undefined;
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<LeaveRequestRecord[]>;
  /** Số dư đã lưu của nhiều người cùng năm (danh sách HR) — người chưa có dòng không có trong map. */
  findBalances(
    workspaceId: string,
    userIds: readonly string[],
    year: number,
  ): Promise<ReadonlyMap<string, LeaveBalanceRecord>>;
  /** Đơn PENDING/APPROVED có `startDate` trong `year` của nhiều người (như `listHolding`, một truy vấn). */
  listHoldingFor(
    workspaceId: string,
    userIds: readonly string[],
    year: number,
  ): Promise<LeaveRequestRecord[]>;
  /** Số dư đã lưu — KHÔNG tạo (GET không ghi); chưa có ⇒ `null` (bên gọi dùng mặc định 12 ngày). */
  findBalance(
    workspaceId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalanceRecord | null>;
}

/** Tên hiển thị (`user`, `decidedBy`) — adapter của auth nối ở composition root, như `IUserRefReader` của attendance. */
export interface ILeaveUserRefs {
  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, UserRefDto>>;
}

/** Khóa keyset danh sách nhân viên: (fullName, id) tăng dần. */
export interface EmployeeKey {
  readonly fullName: string;
  readonly id: string;
}

/**
 * Nhân viên HIỆN TẠI của workspace (OWNER/PM/MEMBER — như `isEmployee` của T-037), sắp theo tên rồi id. Dùng cho
 * `GET leave-balances?year=` (HR): mọi nhân viên kể cả chưa có dòng số dư.
 */
export interface ILeaveEmployeeDirectory {
  listEmployees(
    workspaceId: string,
    after: EmployeeKey | null,
    limit: number,
  ): Promise<UserRefDto[]>;
}
