import { AppError, type ErrorCode } from './app-error';

/** 500 — lỗi không lường trước. Thông điệp cố định; nguyên nhân chỉ nằm trong `cause` để log. */
export class InternalError extends AppError {
  readonly statusCode = 500;
  readonly code: ErrorCode = 'INTERNAL_ERROR';

  constructor(cause?: unknown) {
    super('Đã có lỗi xảy ra, vui lòng thử lại sau.', null, cause);
  }
}

/** 503 — phụ thuộc bắt buộc không dùng được (vd Valkey và DB cùng lỗi khi kiểm `token_version`). */
export class ServiceUnavailableError extends AppError {
  readonly statusCode = 503;
  readonly code: ErrorCode = 'SERVICE_UNAVAILABLE';

  constructor(message = 'Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau.', cause?: unknown) {
    super(message, null, cause);
  }
}
