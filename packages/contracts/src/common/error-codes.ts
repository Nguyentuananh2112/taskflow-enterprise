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
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** `details.rule` của `BUSINESS_RULE_VIOLATION`. */
export const BusinessRule = z.enum(['LAST_OWNER', 'ASSIGNEE_NOT_MEMBER', 'INVALID_ANCHOR']);
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

export const NotFoundDetails = z.object({
  resource: z.enum(['task', 'project', 'workspace', 'user']),
});
export type NotFoundDetails = z.infer<typeof NotFoundDetails>;

export const ResourceConflictDetails = z.object({
  field: z.string().optional(),
  reason: z.string().min(1),
});
export type ResourceConflictDetails = z.infer<typeof ResourceConflictDetails>;

export const BusinessRuleDetails = z.object({ rule: BusinessRule });
export type BusinessRuleDetails = z.infer<typeof BusinessRuleDetails>;

export const RateLimitedDetails = z.object({ retryAfterSec: z.int().min(0) });
export type RateLimitedDetails = z.infer<typeof RateLimitedDetails>;

export const ForbiddenDetails = z.object({ required: z.string().optional() });
export type ForbiddenDetails = z.infer<typeof ForbiddenDetails>;
