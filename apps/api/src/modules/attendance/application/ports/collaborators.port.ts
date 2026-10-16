import type { UserRefDto } from '@taskflow/contracts';

/**
 * Cổng sang module khác (ADR-093: module không import nội bộ của nhau) — attendance sở hữu, adapter nối ở
 * composition root.
 */

/** Vai trò HIỆN TẠI trong workspace; không còn là thành viên ⇒ null. */
export interface IMemberDirectory {
  roleOf(q: {
    workspaceId: string;
    userId: string;
  }): Promise<'OWNER' | 'PM' | 'MEMBER' | 'VIEWER' | null>;
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
 * `HrAuditLog` (thiết kế §3, bảng do T-037 tạo): chỉ thêm, trong cùng transaction. `before`/`after` KHÔNG
 * chứa lý do nghỉ / IP / UA (§9).
 */
export interface IHrAuditLog {
  append(entry: {
    workspaceId: string;
    actorId: string;
    action: HrAuditAction;
    targetUserId: string | null;
    refId: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }): Promise<void>;
}
