import * as z from 'zod';

import { UserRefDto } from '../auth/auth.schemas';
import { Cursor, DateOnly, IsoDateTime, Uuid, limitQuery } from '../common/primitives';

/**
 * Hợp đồng dùng chung của Mốc 3 (attendance-leave.md §3, §5) — T-037 chốt sớm để T-038 (A),
 * T-039 (D), T-040 (B), T-041 (E) dùng chung một nguồn. Schema riêng của chấm công / nghỉ phép
 * (body, DTO bảng công, đơn nghỉ) nằm ở file của từng vé.
 */

/** Khớp enum Postgres `LeaveType` (migration 3). */
export const LeaveType = z.enum(['ANNUAL', 'SICK', 'PERSONAL_PAID', 'UNPAID', 'OTHER']);
export type LeaveType = z.infer<typeof LeaveType>;

export const LeaveDayPart = z.enum(['FULL', 'AM', 'PM']);
export type LeaveDayPart = z.infer<typeof LeaveDayPart>;

export const LeaveStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED']);
export type LeaveStatus = z.infer<typeof LeaveStatus>;

export const AttendanceKind = z.enum(['IN', 'OUT']);
export type AttendanceKind = z.infer<typeof AttendanceKind>;

export const AttendanceSource = z.enum(['WEB', 'DEVICE', 'ADJUSTMENT']);
export type AttendanceSource = z.infer<typeof AttendanceSource>;

// ---------------------------------------------------------------- thông báo (ADR-123, T-040)

export const NotificationType = z.enum([
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'LEAVE_REVOKED',
  'ATTENDANCE_ADJUSTED',
  // Mốc 3.5: HR_GRANTED / HR_REVOKED (grant theo workspace) ⇒ ACCESS_CHANGED; nghỉ việc.
  'ACCESS_CHANGED',
  'OFFBOARD_SCHEDULED',
  'OFFBOARD_CLEANUP',
  // Mốc 5 (ADR-128): HR sửa hồ sơ của bạn — refId = userId, KHÔNG mang giá trị hồ sơ.
  'PROFILE_UPDATED',
  // Mốc 5 (ADR-129): đơn bổ sung giờ — refId = id đơn; KHÔNG mang lý do (B-H2). SUBMITTED / CANCELLED dành cho HR.
  'CORRECTION_SUBMITTED',
  'CORRECTION_APPROVED',
  'CORRECTION_REJECTED',
  'CORRECTION_CANCELLED',
  // Mốc 4 (payroll.md §4): KHÔNG số tiền; refId = id phiếu (PUBLISHED / REVISED) hoặc id bảng lương (REMINDER).
  'PAYSLIP_PUBLISHED',
  'PAYSLIP_REVISED',
  'PAYROLL_REMINDER',
]);
export type NotificationType = z.infer<typeof NotificationType>;

/**
 * `GET /api/v1/me/notifications` — ngữ cảnh tối thiểu join sẵn lúc đọc (góp ý E). `leave` KHÔNG có
 * lý do (có thể là dữ liệu sức khỏe — B-H2). Chỉ thông báo của tư cách công ty hiện tại; loại
 * "dành cho HR" lọc theo quyền HIỆN TẠI (B-H3b).
 */
export const NotificationDto = z.object({
  id: Uuid,
  type: NotificationType,
  refId: Uuid,
  /** Mốc 6 (ADR-142): `UserRefDto` ⇒ có `avatarUrl` (variant 64) tùy chọn. */
  actor: UserRefDto.nullable(),
  leave: z.object({ type: LeaveType, startDate: DateOnly, endDate: DateOnly }).nullable(),
  /** PAYSLIP_PUBLISHED / PAYSLIP_REVISED (`refId` = id phiếu): kỳ lương để mở `/payslips/YYYY-MM` — KHÔNG số tiền. */
  payslip: z
    .object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
    .nullable()
    .optional(),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type NotificationDto = z.infer<typeof NotificationDto>;

/** `GET /api/v1/me/notifications` — mới nhất trước, cursor opaque (data-and-api §3.1); không có `userId` — luôn của mình (Q6). */
export const ListNotificationsQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuery>;

export const NotificationParams = z.object({ id: Uuid });
export type NotificationParams = z.infer<typeof NotificationParams>;

export const UnreadNotificationCountDto = z.object({ count: z.int().min(0) });
export type UnreadNotificationCountDto = z.infer<typeof UnreadNotificationCountDto>;

// ---------------------------------------------------------------- HrAuditLog (B-L1: chỉ OWNER đọc)

export const HrAuditAction = z.enum([
  'SCHEDULE_SET',
  'HOLIDAY_SET',
  'HOLIDAY_DELETE',
  'EVENT_ADJUST',
  'EVENT_VOID',
  'LEAVE_SUBMIT',
  'LEAVE_CANCEL',
  'LEAVE_DECIDE',
  'LEAVE_REVOKE',
  'BALANCE_ADJUST',
  'EXPORT',
  // Mốc 3.5 (company-level.md §3): GRANT / REVOKE theo workspace bỏ.
  'COMPANY_ROLE_SET',
  'GRANT_SET',
  'EMPLOYEE_HIRED',
  'EMPLOYEE_REHIRED',
  'EMPLOYEE_OFFBOARD_SCHEDULED',
  'EMPLOYEE_OFFBOARD_CANCELLED',
  'EMPLOYEE_OFFBOARD_COMPLETED',
  'OFFBOARD_CLEANUP',
  'ACTIVATION_LINK_ISSUED',
  'WORKSPACE_OWNER_ASSIGNED',
  'WORKSPACE_ARCHIVED',
  'COMPANY_RENAMED',
  // Mốc 5 (T-057, ADR-131): HR đặt chính sách phép một năm (lý do ở `after.note`).
  'POLICY_SET',
  // Mốc 5 (ADR-128): hồ sơ nhân viên — before/after KHÔNG có workPhone (chỉ cờ), lý do ở `after.note`.
  'PROFILE_SET',
  // Mốc 5 (ADR-129): đơn bổ sung giờ — before/after KHÔNG có `reason` của nhân viên; ghi chú HR ở `after.note`.
  'CORRECTION_SUBMIT',
  'CORRECTION_CANCEL',
  'CORRECTION_DECIDE',
  // Mốc 6 (ADR-142): HR / Admin gỡ ảnh đại diện không phù hợp của nhân viên.
  'AVATAR_REMOVED',
  // Mốc 4 (payroll.md §6, T-048): before/after CÓ số tiền ⇒ chỉ Admin đọc. Tiền tố `PAYROLL_` là ranh giới retention:
  // mọi bước D7 / D7' BỎ QUA các action này (RD-11 — hạn lưu lương riêng). ≤ 32 ký tự.
  'PAYROLL_SETTINGS_SET',
  'PAYROLL_SALARY_SET',
  'PAYROLL_RUN_CREATE',
  'PAYROLL_RECALCULATE',
  'PAYROLL_ADD_MISSING',
  'PAYROLL_PAYSLIP_SET',
  'PAYROLL_PUBLISH',
  'PAYROLL_PAYSLIP_REVISE',
  'PAYROLL_PAYSLIP_VIEW',
  'PAYROLL_EXPORT',
]);
export type HrAuditAction = z.infer<typeof HrAuditAction>;

/** `before` / `after` KHÔNG BAO GIỜ chứa `reason` của đơn nghỉ (B-H2). */
export const HrAuditLogDto = z.object({
  id: Uuid,
  action: HrAuditAction,
  /** null = `admin:bootstrap` (CLI — không có người). */
  actor: z.object({ id: Uuid, fullName: z.string() }).nullable(),
  targetUserId: Uuid.nullable(),
  refId: Uuid.nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoDateTime,
});
export type HrAuditLogDto = z.infer<typeof HrAuditLogDto>;

/** `GET /hr/audit-logs` — chỉ Admin (`company:admin`); mới nhất trước (createdAt, id giảm dần). */
export const ListHrAuditLogsQuery = z.object({
  cursor: Cursor.optional(),
  limit: limitQuery(100, 50),
});
export type ListHrAuditLogsQuery = z.infer<typeof ListHrAuditLogsQuery>;
