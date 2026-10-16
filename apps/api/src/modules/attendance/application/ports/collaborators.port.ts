import type { UserRefDto } from '@taskflow/contracts';

/**
 * Cổng sang module khác (ADR-093: module không import nội bộ của nhau) — attendance sở hữu, adapter nối ở
 * composition root.
 */

/**
 * Chốt ghi HR của workspace (T-037 `HrAccess`). `authorizeWrite` gọi TRONG `uow.run`, TRƯỚC khi ghi:
 * khóa membership người gọi FOR SHARE + đọc lại quyền ⇒ 404 workspace / 403 `hr:manage`; tự xử lý dữ liệu
 * của mình ⇒ 403 trừ OWNER, OWNER thiếu lý do ⇒ 422 `REASON_REQUIRED`. Trả role đã đọc lại.
 */
export interface IHrAccess {
  authorizeWrite(input: {
    workspaceId: string;
    actorId: string;
    targetUserId?: string | null;
    reason?: string | null;
  }): Promise<{ role: 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER' }>;
  /** Nhân viên hiện tại (OWNER / PM / MEMBER — VIEWER là khách). */
  isEmployee(q: { workspaceId: string; userId: string }): Promise<boolean>;
}

/** Tên hiển thị của user (`createdBy` / `voidedBy`); user ẩn danh ⇒ "Người dùng đã xóa" (auth). */
export interface IUserRefReader {
  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, UserRefDto>>;
}

/**
 * Thông báo bền trong app (ADR-123, T-040 của B). Ghi TRONG transaction của thay đổi nghiệp vụ; payload chỉ
 * id + loại (không chép lý do). Tới khi T-040 xong: fake ghi nhận lời gọi.
 */
export interface AttendanceNotifier {
  attendanceAdjusted(q: {
    workspaceId: string;
    recipientId: string;
    eventId: string;
    actorId: string;
  }): Promise<void>;
}

export type HrAuditAction =
  'EVENT_ADJUST' | 'EVENT_VOID' | 'SCHEDULE_SET' | 'HOLIDAY_SET' | 'HOLIDAY_DELETE' | 'EXPORT';

/**
 * Ghi `HrAuditLog` (T-037 `HrAuditWriter`): chỉ thêm, trong cùng transaction. `before`/`after` KHÔNG có khóa
 * `reason` (B-H2 — writer ném lỗi), không IP / UA (§9).
 */
export interface IHrAuditRecorder {
  record(entry: {
    workspaceId: string;
    actorId: string;
    action: HrAuditAction;
    targetUserId?: string | null;
    refId?: string | null;
    before?: Readonly<Record<string, unknown>> | null;
    after?: Readonly<Record<string, unknown>> | null;
  }): Promise<void>;
}
