// Thông báo bền trong app (ADR-123). Thuần TS (không import contracts — ADR-043); parity với
// `NotificationType` của contracts + enum Postgres: notification-parity.test.ts (ADR-080).

export const NOTIFICATION_TYPES = [
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'LEAVE_REVOKED',
  'ATTENDANCE_ADJUSTED',
  'HR_GRANTED',
  'HR_REVOKED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Loại "dành cho HR" (attendance-leave.md §9 bảng chuyển: gửi đơn / hủy đơn ⇒ báo HR). Người nhận chỉ
 * thấy chúng khi HIỆN TẠI còn `hr:manage` trong workspace đó (B-H3b) — thu grant ⇒ biến khỏi chuông.
 */
export const HR_AUDIENCE_TYPES: readonly NotificationType[] = [
  'LEAVE_SUBMITTED',
  'LEAVE_CANCELLED',
];

/** Loại có ngữ cảnh đơn nghỉ (`refId` = id đơn) — DTO join loại + khoảng ngày, KHÔNG lý do (B-H2). */
export const LEAVE_TYPES: readonly NotificationType[] = [
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'LEAVE_REVOKED',
];

export interface NotificationRecord {
  id: string;
  workspaceId: string;
  recipientId: string;
  type: NotificationType;
  /** id đơn / lượt chấm / membership — đa hình, không FK. */
  refId: string;
  actorId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Phạm vi người nhận được thấy, dựng từ membership HIỆN TẠI mỗi request (không cache, không tin token):
 * `full` = ws còn là thành viên VÀ có `hr:manage` (thấy mọi loại); `basic` = còn là thành viên nhưng
 * không có `hr:manage` (ẩn `HR_AUDIENCE_TYPES`). Ws không có trong hai danh sách ⇒ ẩn hết (SEC-HR-18).
 */
export interface VisibilityScope {
  recipientId: string;
  full: readonly string[];
  basic: readonly string[];
}

/** Hàm thuần — bản InMemory dùng trực tiếp; bản Prisma dịch cùng điều kiện sang WHERE. */
export function isVisible(n: NotificationRecord, scope: VisibilityScope): boolean {
  if (n.recipientId !== scope.recipientId) return false;
  if (scope.full.includes(n.workspaceId)) return true;
  return scope.basic.includes(n.workspaceId) && !HR_AUDIENCE_TYPES.includes(n.type);
}
