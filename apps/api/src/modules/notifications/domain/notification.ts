// Thông báo bền trong app (ADR-123), cấp CÔNG TY (Mốc 3.5, ADR-136 — không còn workspace). Thuần TS (không import
// contracts — ADR-043); parity với `NotificationType` của contracts + enum Postgres (ADR-080).

export const NOTIFICATION_TYPES = [
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'LEAVE_REVOKED',
  'ATTENDANCE_ADJUSTED',
  'ACCESS_CHANGED',
  'OFFBOARD_SCHEDULED',
  'OFFBOARD_CLEANUP',
  'PROFILE_UPDATED',
  'PAYSLIP_PUBLISHED',
  'PAYSLIP_REVISED',
  'PAYROLL_REMINDER',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Loại "dành cho HR" (gửi đơn / hủy đơn / dọn đơn khi nghỉ việc ⇒ báo HR). Người nhận chỉ thấy khi HIỆN TẠI
 * còn `hr:manage` (B-H3b) — thu grant ⇒ biến khỏi chuông.
 */
export const HR_AUDIENCE_TYPES: readonly NotificationType[] = [
  'LEAVE_SUBMITTED',
  'LEAVE_CANCELLED',
  'OFFBOARD_CLEANUP',
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
  recipientId: string;
  type: NotificationType;
  /** id đơn / lượt chấm / người — đa hình, không FK. */
  refId: string;
  actorId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Phạm vi người nhận được thấy, dựng từ tư cách công ty HIỆN TẠI mỗi request (không cache, không tin token):
 * `null` = không còn thuộc công ty / quá `access_until` ⇒ ẩn hết; thông báo trước `since` (đầu tư cách hiện
 * tại — nhận lại người cũ không thấy thông báo cũ, T-040b L3) ⇒ ẩn; không `hr` ⇒ ẩn loại HR (B-H3b).
 */
export interface VisibilityScope {
  recipientId: string;
  access: { since: Date; hr: boolean } | null;
}

/** Hàm thuần — bản InMemory dùng trực tiếp; bản Prisma dịch cùng điều kiện sang WHERE. */
export function isVisible(n: NotificationRecord, scope: VisibilityScope): boolean {
  if (n.recipientId !== scope.recipientId || !scope.access) return false;
  if (n.createdAt < scope.access.since) return false;
  return scope.access.hr || !HR_AUDIENCE_TYPES.includes(n.type);
}
