import type { CalendarDate, CalendarDay, HalfDays, LeaveDayPart } from '../../domain/leave-days';
import type { LeaveType } from '../../domain/leave-balance';
import type { LeaveStatus } from '../../domain/leave-status';

// ---------------------------------------------------------------- lịch (do attendance cung cấp adapter — §4)

/** Một ngày của lịch hiệu lực ngày đó (thiết kế §4: `workingDays`). Leave chỉ cần múi giờ trong `schedule`. */
export interface WorkCalendarDay extends CalendarDay {
  readonly schedule: { readonly timezone: string };
}

/**
 * Port do LEAVE sở hữu (D-H4, thiết kế §4) — adapter A viết trong module attendance, nối ở composition root.
 * Trả MỌI ngày trong [from, to] (kể cả ngày nghỉ) theo lịch hiệu lực của từng ngày + ngày lễ hiện tại.
 */
export interface IWorkCalendarPort {
  workingDays(input: {
    workspaceId: string;
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<WorkCalendarDay[]>;
}

// ---------------------------------------------------------------- lưu trữ

export interface LeaveRequestRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly type: LeaveType;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  readonly dayPart: LeaveDayPart;
  /** Dữ liệu nhạy cảm (B-H2): chỉ người gửi + `hr:manage` đọc; không vào thông báo / log / audit / CSV. */
  readonly reason: string;
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

/** Mọi truy vấn có phạm vi tenant (`workspaceId`) — không có `findById` trần (data-and-api §2.2). */
export interface ILeaveRepository {
  /**
   * Khóa (ws, user) tới hết transaction: `pg_advisory_xact_lock(hashtextextended('taskflow:leave:<ws>:<user>', 0))`.
   * MỌI thao tác đổi số dư / chồng ngày (submit, approve, cancel, revoke, PATCH balance) lấy khóa này TRƯỚC khi
   * đọc (D-H2) ⇒ tính lại trong khóa là đúng.
   */
  lockUser(workspaceId: string, userId: string): Promise<void>;
  /** Đơn PENDING/APPROVED của người đó có ngày trong `year` (chồng ngày + số dư — đơn không vắt năm). */
  listHolding(workspaceId: string, userId: string, year: number): Promise<LeaveRequestRecord[]>;
  find(workspaceId: string, id: string): Promise<LeaveRequestRecord | null>;
  add(record: LeaveRequestRecord): Promise<void>;
  /** UPDATE có điều kiện `version = expectedVersion` (+ tenant); `false` ⇒ 409 `version_conflict`. */
  save(record: LeaveRequestRecord, expectedVersion: number): Promise<boolean>;
  /** Tạo lười `entitled 24, adjustment 0` bằng `INSERT … ON CONFLICT DO NOTHING` rồi đọc (LB-01). */
  getOrCreateBalance(
    workspaceId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalanceRecord>;
  setBalanceAdjustment(
    workspaceId: string,
    userId: string,
    year: number,
    adjustment: HalfDays,
  ): Promise<void>;
  /** `userId` có dữ liệu nghỉ phép/đơn trong ws — dùng cho 404 khi HR hỏi người lạ (LB-06). */
  hasHistory(workspaceId: string, userId: string): Promise<boolean>;
}

// ---------------------------------------------------------------- thành viên & quyền (adapter: workspace, T-037)

export type LeaveRole = 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER';

export interface LeaveActor {
  readonly userId: string;
  readonly role: LeaveRole;
  /** Quyền HIỆU LỰC = role ∪ grants (ADR-119) — vd `leave:self`, `hr:manage`. */
  readonly permissions: ReadonlySet<string>;
}

export interface ILeaveMembership {
  /**
   * Membership + quyền HIỆN TẠI của actor, đọc lại SAU khi lấy khóa trong transaction (B-H3: thu grant giữa
   * lúc mở form và bấm duyệt ⇒ 403). Không còn là thành viên ⇒ `null`.
   */
  reloadActor(workspaceId: string, userId: string): Promise<LeaveActor | null>;
  /** Người gửi còn là thành viên đủ điều kiện xin nghỉ (OWNER/PM/MEMBER — không VIEWER) (D-M4). */
  isEligibleRequester(workspaceId: string, userId: string): Promise<boolean>;
}

// ---------------------------------------------------------------- thông báo (T-040) & audit (T-037)

export type LeaveNotificationType =
  'LEAVE_SUBMITTED' | 'LEAVE_APPROVED' | 'LEAVE_REJECTED' | 'LEAVE_CANCELLED' | 'LEAVE_REVOKED';

/** Ghi thông báo TRONG CÙNG transaction (ADR-123). Payload chỉ id + loại — KHÔNG lý do nghỉ (B-H2). */
export interface ILeaveNotifier {
  notify(input: {
    workspaceId: string;
    type: LeaveNotificationType;
    requestId: string;
    actorId: string;
    /** `hr` ⇒ mọi người có `hr:manage` hiện tại trong ws (adapter T-040 tự mở rộng danh sách). */
    recipient: { kind: 'user'; userId: string } | { kind: 'hr' };
  }): Promise<void>;
}

export type HrAuditAction =
  'LEAVE_SUBMIT' | 'LEAVE_CANCEL' | 'LEAVE_DECIDE' | 'LEAVE_REVOKE' | 'BALANCE_ADJUST';

/** `HrAuditLog` chỉ thêm (T-037). `before`/`after` KHÔNG chứa `reason` của đơn (B-H2). */
export interface IHrAudit {
  record(input: {
    workspaceId: string;
    actorId: string;
    action: HrAuditAction;
    targetUserId: string;
    refId: string | null;
    before: Readonly<Record<string, unknown>> | null;
    after: Readonly<Record<string, unknown>> | null;
    /** Lý do QUẢN TRỊ (OWNER tự xử lý — R26, thu hồi, chỉnh số dư) — không phải lý do nghỉ. */
    note?: string | null;
  }): Promise<void>;
}
