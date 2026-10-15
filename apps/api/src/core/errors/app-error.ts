/** Danh mục `error.code` (data-and-api.md §3.2). Thêm code mới ⇒ thêm lớp lỗi + test catalog. */
export const ERROR_CODES = [
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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorDetails = Readonly<Record<string, unknown>> | null;

/**
 * Gốc của mọi lỗi có chủ đích. Mỗi lớp con tự mang `statusCode` + `code` (polymorphism —
 * error handler không rẽ nhánh theo loại lỗi). `message` là tiếng Việt cho người đọc;
 * FE chỉ rẽ nhánh theo `code` (+ `details.rule`).
 *
 * Không phụ thuộc HTTP framework/Zod/contracts ⇒ domain được phép ném (ADR-004, ADR-043).
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: ErrorCode;
  readonly details: ErrorDetails;

  protected constructor(message: string, details: ErrorDetails = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.details = details;
  }

  /** Header HTTP đi kèm (vd `Retry-After`). Mặc định không có. */
  get headers(): Readonly<Record<string, string>> {
    return {};
  }
}
