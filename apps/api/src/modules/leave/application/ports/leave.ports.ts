import type { CalendarDate, CalendarDay, HalfDays, LeaveDayPart } from '../../domain/leave-days';
import type { LeaveType } from '../../domain/leave-balance';
import type { LeaveStatus } from '../../domain/leave-status';
import type { LeaveTenure } from '../../domain/leave-tenure';

// Phạm vi CÔNG TY (company-level.md ADR-133/136): một công ty, không `workspaceId` ở bảng / khóa / port.

// ---------------------------------------------------------------- lịch (adapter: attendance — AttendanceWorkCalendar)

/** Một ngày của lịch hiệu lực ngày đó. Leave chỉ cần múi giờ trong `schedule`. */
export interface WorkCalendarDay extends CalendarDay {
  readonly schedule: { readonly timezone: string };
}

/**
 * Port do LEAVE sở hữu (D-H4) — adapter A viết trong module attendance, nối ở composition root. Trả MỌI ngày trong
 * [from, to] (kể cả ngày nghỉ) theo lịch công ty hiệu lực của từng ngày + ngày lễ hiện tại.
 */
export interface IWorkCalendarPort {
  workingDays(input: { from: CalendarDate; to: CalendarDate }): Promise<WorkCalendarDay[]>;
}

// ---------------------------------------------------------------- lưu trữ

export interface LeaveRequestRecord {
  readonly id: string;
  readonly userId: string;
  readonly type: LeaveType;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  readonly dayPart: LeaveDayPart;
  /**
   * Dữ liệu nhạy cảm (B-H2): chỉ người gửi + `hr:manage` đọc; không vào thông báo / log / audit / CSV. TÙY CHỌN
   * — `null` khi bỏ trống; DB cho NULL + CHECK không rỗng ⇒ phải chuẩn hóa trước khi ghi.
   */
  readonly reason: string | null;
  readonly status: LeaveStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LeaveBalanceRecord {
  readonly entitled: HalfDays;
  readonly adjustment: HalfDays;
}

export interface ILeaveRepository {
  /**
   * Khóa người dùng tới hết transaction: `pg_advisory_xact_lock(hashtextextended('taskflow:leave:<user>', 0))` — bậc 3
   * của bảng khóa toàn cục (ADR-136). MỌI thao tác đổi số dư / chồng ngày (submit, approve, cancel, revoke, PATCH
   * balance, dọn đơn khi nghỉ việc, reset khi nhận lại) lấy khóa này TRƯỚC khi đọc (D-H2).
   */
  lockUser(userId: string): Promise<void>;
  /** Đơn PENDING/APPROVED của người đó có `startDate` trong `year` (chồng ngày + số dư — đơn không vắt năm). */
  listHolding(userId: string, year: number): Promise<LeaveRequestRecord[]>;
  /** Mọi đơn PENDING/APPROVED của người đó (mọi năm) — `offboardCleanup`. Sắp `startDate`, `id`. */
  listOpen(userId: string): Promise<LeaveRequestRecord[]>;
  find(id: string): Promise<LeaveRequestRecord | null>;
  add(record: LeaveRequestRecord): Promise<void>;
  /** UPDATE có điều kiện `version = expectedVersion`; `false` ⇒ 409 `version_conflict`. */
  save(record: LeaveRequestRecord, expectedVersion: number): Promise<boolean>;
  /** Tạo lười `entitled 24, adjustment 0` bằng `INSERT … ON CONFLICT DO NOTHING` rồi đọc (LB-01). */
  getOrCreateBalance(userId: string, year: number): Promise<LeaveBalanceRecord>;
  setBalanceAdjustment(userId: string, year: number, adjustment: HalfDays): Promise<void>;
}

// ---------------------------------------------------------------- công ty & quyền (adapter: company, T-061)

export type LeaveRole = 'ADMIN' | 'EMPLOYEE';

export interface LeaveActor {
  readonly userId: string;
  readonly role: LeaveRole;
  /** Quyền công ty HIỆU LỰC = role ∪ grants (ADR-135) — vd `leave:self` (chỉ EMPLOYEE), `hr:manage`. */
  readonly permissions: ReadonlySet<string>;
}

/** Tình trạng làm việc của một người — đọc trong cùng transaction (adapter đọc `company_members` + departures). */
export interface LeaveEmployment {
  /** Nhiệm kỳ EMPLOYEE hiện tại (`until` = null); không có (Admin / đã nghỉ) ⇒ `null`. */
  readonly current: LeaveTenure | null;
  /** `offboard_last_day` nếu đã có lịch nghỉ việc (D H1 — `AFTER_LAST_DAY`). */
  readonly lastDay: CalendarDate | null;
}

export interface ILeaveCompany {
  /**
   * Quyền HIỆN TẠI của actor (không cache). Không còn thuộc công ty / quá `access_until` ⇒ `null` (bên gọi ném 401
   * `SESSION_REVOKED` — ADR-135).
   */
  reloadActor(userId: string): Promise<LeaveActor | null>;
  /**
   * Chốt ghi HR (= `ICompanyAccess.authorizeWrite`): khóa dòng `company_members` của actor FOR SHARE (bậc 5, SAU
   * `taskflow:leave:<user>`), đọc lại role + grants (B-H3) ⇒ 401 / 403 `hr:manage`; `targetUserId === actorId` ⇒ 403
   * tuyệt đối (Admin không có dữ liệu nghỉ phép — ADR-134).
   */
  authorizeHrWrite(input: {
    actorId: string;
    targetUserId: string | null;
    reason: string | null;
  }): Promise<LeaveActor>;
  /** Lệnh của chính nhân viên, SAU khóa nghiệp vụ (A C2): còn là EMPLOYEE + chưa quá `access_until` — không thì 401. */
  assertActiveEmployee(userId: string): Promise<void>;
  /** Người gửi còn là nhân viên (EMPLOYEE, có dòng hiệu lực) — duyệt đơn (D-M4, 409 `requester_not_member`). */
  isEmployee(userId: string): Promise<boolean>;
  employmentOf(userId: string): Promise<LeaveEmployment>;
  /**
   * Các nhiệm kỳ EMPLOYEE (đã đóng + hiện tại) giao [from, to] (= `ICompanyTenurePort.tenuresOf`). Dùng cho PATCH
   * số dư (người TỪNG là nhân viên trong năm đó) và đếm cắt theo nhiệm kỳ.
   */
  tenuresOf(input: {
    userIds: readonly string[];
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<ReadonlyMap<string, readonly LeaveTenure[]>>;
}

// ---------------------------------------------------------------- thông báo (T-040) & audit

export type LeaveNotificationType =
  | 'LEAVE_SUBMITTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_CANCELLED'
  | 'LEAVE_REVOKED'
  | 'OFFBOARD_CLEANUP';

/** Ghi thông báo TRONG CÙNG transaction (ADR-123). Payload chỉ id + loại — KHÔNG lý do nghỉ (B-H2). */
export interface ILeaveNotifier {
  notify(input: {
    type: LeaveNotificationType;
    /** Id đơn; `OFFBOARD_CLEANUP` ⇒ id người nghỉ việc (một thông báo tổng cho HR). */
    requestId: string;
    actorId: string;
    /** `hr` ⇒ mọi người có `hr:manage` hiện tại + Admin, trừ actor (adapter T-040 tự mở rộng danh sách). */
    recipient: { kind: 'user'; userId: string } | { kind: 'hr' };
  }): Promise<void>;
}

export type HrAuditAction =
  'LEAVE_SUBMIT' | 'LEAVE_CANCEL' | 'LEAVE_DECIDE' | 'LEAVE_REVOKE' | 'BALANCE_ADJUST';

/** `HrAuditLog` chỉ thêm. `before`/`after` KHÔNG chứa `reason` của đơn (B-H2). */
export interface IHrAudit {
  record(input: {
    actorId: string;
    action: HrAuditAction;
    targetUserId: string;
    refId: string | null;
    before: Readonly<Record<string, unknown>> | null;
    after: Readonly<Record<string, unknown>> | null;
    /** Lý do QUẢN TRỊ (thu hồi, chỉnh số dư, dọn đơn khi nghỉ việc) — không phải lý do nghỉ. */
    note?: string | null;
  }): Promise<void>;
}
