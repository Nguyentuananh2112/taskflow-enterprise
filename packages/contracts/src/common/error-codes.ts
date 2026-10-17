import * as z from 'zod';

/**
 * Danh mục `error.code` (data-and-api §3.2). Ánh xạ code → HTTP status thuộc về API, không ở đây.
 * FE chỉ rẽ nhánh theo `code` (+ `details.rule`), không theo `message`.
 */
export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'INVALID_CREDENTIALS',
  'INVALID_CURRENT_PASSWORD',
  'REFRESH_TOKEN_INVALID',
  'ORIGIN_NOT_ALLOWED',
  'FORBIDDEN_ACCESS',
  'RESOURCE_NOT_FOUND',
  'VERSION_CONFLICT',
  'RESOURCE_CONFLICT',
  'EMAIL_ALREADY_EXISTS',
  'REFRESH_IN_PROGRESS',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INVALID_STATUS_TRANSITION',
  'PROJECT_ARCHIVED',
  'BUSINESS_RULE_VIOLATION',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  // Mốc 3.5 (ADR-135, ADR-137)
  'SESSION_REVOKED',
  'ACTIVATION_INVALID',
  'ACTIVATION_GONE',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** `details.rule` của `BUSINESS_RULE_VIOLATION`. */
export const BusinessRule = z.enum([
  'LAST_OWNER',
  'ASSIGNEE_NOT_MEMBER',
  'INVALID_ANCHOR',
  // Mốc 3 (Tech Lead chốt): 422 `details.rule` VIẾT HOA. T-038/039 chỉ dùng, không thêm riêng.
  'NOT_CHECKED_IN',
  'IDEMPOTENCY_KEY_REUSED',
  'HOLIDAY_IN_PAST',
  'SCHEDULE_IN_PAST',
  'REASON_REQUIRED',
  'NO_WORKING_DAYS',
  'INSUFFICIENT_BALANCE',
  'LEAVE_SPANS_YEARS',
  // ADR-119: cấp grant cho OWNER (đã có qua role — B-M2) hoặc VIEWER (không phải nhân viên).
  'GRANT_NOT_ALLOWED',
  // T-043 / R27: ghi lượt chấm / ngày lễ cho ngày đã quá thời hạn lưu (job retention sẽ xóa ngay).
  'OUTSIDE_RETENTION',
  // Mốc 3.5 (company-level.md): thêm thành viên ws phải thuộc công ty; Admin giao OWNER cho thành viên ws;
  // chấm ngoài nhiệm kỳ; đơn sau ngày làm cuối; email của tài khoản đã xóa.
  'NOT_ACTIVE_MEMBER',
  'NOT_WORKSPACE_MEMBER',
  'NOT_EMPLOYED',
  'AFTER_LAST_DAY',
  'EMAIL_UNAVAILABLE',
  // Mốc 3.5 (E 17/10): ngày theo "hôm nay" của giờ nghiệp vụ ⇒ luật nghiệp vụ (422), không phải validate 400.
  'START_DATE_OUT_OF_RANGE',
  'LAST_DAY_OUT_OF_RANGE',
  'ALREADY_ACTIVATED',
  // Mốc 5 (T-054, ADR-128): `hireDate` sau "hôm nay" của giờ nghiệp vụ — cùng kiểu START_DATE_OUT_OF_RANGE.
  'HIRE_DATE_IN_FUTURE',
  // Mốc 5 (hr-extended ADR-129/130, T-056): đơn bổ sung giờ + xuất Excel bảng công.
  'CORRECTION_DATE_OUT_OF_RANGE',
  'CORRECTION_IN_FUTURE',
  'CORRECTION_EVENT_EXISTS',
  'CORRECTION_TIME_ORDER',
  'CORRECTION_DAY_ON_LEAVE',
  'REQUESTER_NOT_EMPLOYEE',
  'PERIOD_NOT_STARTED',
  'EXPORT_TOO_LARGE',
]);
export type BusinessRule = z.infer<typeof BusinessRule>;

/** Một issue validation trả về client — KHÔNG có `input` (ADR-096). */
export const ValidationIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string().min(1),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ValidationErrorDetails = z.object({ issues: z.array(ValidationIssue).min(1) });
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetails>;

/** `route` = đường dẫn API không tồn tại (404 của router, T-021). */
export const NotFoundDetails = z.object({
  resource: z.enum([
    'task',
    'project',
    'workspace',
    'user',
    'route',
    // Mốc 3 (T-038 / T-039)
    'leave_request',
    'attendance_event',
    'holiday',
    'work_schedule',
    // Mốc 3 (T-040)
    'notification',
    // Mốc 3.5: chưa `admin:bootstrap` ⇒ chưa có dòng `companies`
    'company',
    // Mốc 5 (T-056)
    'correction_request',
  ]),
});
export type NotFoundDetails = z.infer<typeof NotFoundDetails>;

export const ResourceConflictDetails = z.object({
  field: z.string().optional(),
  reason: z.string().min(1),
});
export type ResourceConflictDetails = z.infer<typeof ResourceConflictDetails>;

/** Mốc 3: `details.reason` của 409 `RESOURCE_CONFLICT` — VIẾT THƯỜNG (Tech Lead chốt). */
export const HrConflictReason = z.enum([
  'already_checked_in',
  'already_voided',
  'invalid_transition',
  'overlapping_leave',
  'requester_not_member',
  // Mốc 5 (T-056): đã có đơn bổ sung giờ PENDING cùng (ngày, loại).
  'correction_pending_exists',
]);
export type HrConflictReason = z.infer<typeof HrConflictReason>;

export const BusinessRuleDetails = z.object({ rule: BusinessRule });
export type BusinessRuleDetails = z.infer<typeof BusinessRuleDetails>;

export const RateLimitedDetails = z.object({ retryAfterSec: z.int().min(0) });
export type RateLimitedDetails = z.infer<typeof RateLimitedDetails>;

export const ForbiddenDetails = z.object({ required: z.string().optional() });
export type ForbiddenDetails = z.infer<typeof ForbiddenDetails>;
