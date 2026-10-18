import { AppError, type ErrorCode } from './app-error';

export interface ValidationIssue {
  readonly path: readonly (string | number)[];
  /** Mã issue của Zod (`too_small`, `invalid_format`, …) hoặc mã riêng (`invalid_json`, `invalid_cursor`). */
  readonly code: string;
  readonly message: string;
}

/** 400 — dữ liệu vào sai. KHÔNG chứa `input` của người dùng (ADR-096). */
export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code: ErrorCode = 'VALIDATION_ERROR';
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[], message = 'Dữ liệu không hợp lệ.') {
    super(message, { issues });
    this.issues = issues;
  }
}

/** 400 — đổi mật khẩu sai mật khẩu cũ (cố ý không 401 để FE không nhầm là hết hạn token). */
export class InvalidCurrentPasswordError extends AppError {
  readonly statusCode = 400;
  readonly code: ErrorCode = 'INVALID_CURRENT_PASSWORD';

  constructor(message = 'Mật khẩu hiện tại không đúng.') {
    super(message);
  }
}

export class UnauthorizedError extends AppError {
  readonly statusCode: number = 401;
  readonly code: ErrorCode = 'UNAUTHORIZED';

  constructor(message = 'Bạn cần đăng nhập.') {
    super(message);
  }
}

/** 401 — FE gọi `/auth/refresh` rồi thử lại đúng 1 lần (chỉ với code này). */
export class TokenExpiredError extends UnauthorizedError {
  override readonly code: ErrorCode = 'TOKEN_EXPIRED';

  constructor(message = 'Phiên đăng nhập đã hết hạn.') {
    super(message);
  }
}

/** 401 — sai email/mật khẩu hoặc user đã xóa: một thông điệp chung (chống dò tài khoản). */
export class InvalidCredentialsError extends UnauthorizedError {
  override readonly code: ErrorCode = 'INVALID_CREDENTIALS';

  constructor(message = 'Email hoặc mật khẩu không đúng.') {
    super(message);
  }
}

export class RefreshTokenInvalidError extends UnauthorizedError {
  override readonly code: ErrorCode = 'REFRESH_TOKEN_INVALID';

  constructor(message = 'Phiên đăng nhập không còn hiệu lực.') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode: number = 403;
  readonly code: ErrorCode = 'FORBIDDEN_ACCESS';

  constructor(required?: string, message = 'Bạn không có quyền thực hiện thao tác này.') {
    super(message, required === undefined ? null : { required });
  }
}

/** 403 — Origin không thuộc whitelist trên endpoint dùng cookie (security.md §6.3). */
export class OriginNotAllowedError extends ForbiddenError {
  override readonly code: ErrorCode = 'ORIGIN_NOT_ALLOWED';

  constructor(message = 'Nguồn yêu cầu không được phép.') {
    super(undefined, message);
  }
}

export type ResourceKind =
  | 'task'
  | 'project'
  | 'workspace'
  | 'user'
  | 'route'
  // Mốc 3 (T-038 / T-039)
  | 'leave_request'
  | 'attendance_event'
  | 'holiday'
  | 'work_schedule'
  // Mốc 3 (T-040)
  | 'notification'
  // Mốc 3.5: chưa `admin:bootstrap` ⇒ chưa có dòng `companies`
  | 'company'
  // Mốc 4 (T-049)
  | 'payroll_run'
  | 'payslip'
  // Mốc 5 (T-056): đơn bổ sung giờ
  | 'correction_request'
  // Mốc 6 (T-069): không phải người tham gia ⇒ cùng 404 như không tồn tại (ADR-146)
  | 'conversation'
  | 'message'
  | 'attachment';

/** 404 — không tồn tại **hoặc** thuộc tenant khác (ADR-020): cùng một hình dạng cho cả hai. */
export class ResourceNotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code: ErrorCode = 'RESOURCE_NOT_FOUND';

  constructor(resource: ResourceKind, message = 'Không tìm thấy tài nguyên.') {
    super(message, { resource });
  }
}

export class PayloadTooLargeError extends AppError {
  readonly statusCode = 413;
  readonly code: ErrorCode = 'PAYLOAD_TOO_LARGE';

  constructor(message = 'Dữ liệu gửi lên quá lớn.') {
    super(message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  readonly statusCode = 415;
  readonly code: ErrorCode = 'UNSUPPORTED_MEDIA_TYPE';

  constructor(message = 'Chỉ chấp nhận Content-Type: application/json.') {
    super(message);
  }
}

export class RateLimitedError extends AppError {
  readonly statusCode = 429;
  readonly code: ErrorCode = 'RATE_LIMITED';
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number, message = 'Bạn thao tác quá nhanh, vui lòng thử lại sau.') {
    super(message, { retryAfterSec });
    this.retryAfterSec = retryAfterSec;
  }

  override get headers(): Readonly<Record<string, string>> {
    return { 'Retry-After': String(this.retryAfterSec) };
  }
}
