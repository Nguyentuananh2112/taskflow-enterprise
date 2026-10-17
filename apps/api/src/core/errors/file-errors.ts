import { AppError, type ErrorCode } from './app-error';
import { BusinessRuleViolationError } from './domain-errors';

// Kho tệp Mốc 6 (ADR-141). Thông điệp là lời thường cho người dùng; web rẽ nhánh theo `code`.

/** 400 — header `X-Upload-Name` thiếu / giải mã hỏng / > 255 byte (F-03c). */
export class InvalidUploadNameError extends AppError {
  readonly statusCode = 400;
  readonly code: ErrorCode = 'INVALID_UPLOAD_NAME';

  constructor() {
    super('Tên tệp không hợp lệ.');
  }
}

/** 415 — nội dung ngoài danh sách cho phép, hoặc đuôi không khớp nội dung. */
export class UnsupportedFileTypeError extends AppError {
  readonly statusCode = 415;
  readonly code: ErrorCode = 'UNSUPPORTED_FILE_TYPE';

  constructor() {
    super('Loại tệp này không được hỗ trợ.');
  }
}

/** 415 — tài liệu có macro / liên kết ngoài / đối tượng nhúng. */
export class ActiveContentError extends AppError {
  readonly statusCode = 415;
  readonly code: ErrorCode = 'MACRO_OR_ACTIVE_CONTENT';

  constructor() {
    super('Tài liệu chứa macro hoặc nội dung tự chạy nên không gửi được.');
  }
}

/** 503 — hàng đợi xử lý ảnh đầy (F-03b); `Retry-After` giây. */
export class ImageProcessingBusyError extends AppError {
  readonly statusCode = 503;
  readonly code: ErrorCode = 'IMAGE_PROCESSING_BUSY';
  readonly retryAfterSec: number;

  constructor(retryAfterSec = 5) {
    super('Hệ thống đang xử lý nhiều ảnh, vui lòng thử lại sau ít giây.', { retryAfterSec });
    this.retryAfterSec = retryAfterSec;
  }

  override get headers(): Readonly<Record<string, string>> {
    return { 'Retry-After': String(this.retryAfterSec) };
  }
}

/** 503 — bộ xử lý ảnh không nạp được / không khỏe. */
export class ImageProcessingUnavailableError extends AppError {
  readonly statusCode = 503;
  readonly code: ErrorCode = 'IMAGE_PROCESSING_UNAVAILABLE';

  constructor(cause?: unknown) {
    super('Tạm thời không xử lý được ảnh, vui lòng thử lại sau.', null, cause);
  }
}

/** 507 — kho đầy (`FILE_STORE_MAX_BYTES`) hoặc ổ không đủ chỗ cho tệp này. */
export class StorageFullError extends AppError {
  readonly statusCode = 507;
  readonly code: ErrorCode = 'STORAGE_FULL';

  constructor() {
    super('Kho lưu trữ đã đầy, vui lòng báo quản trị viên.');
  }
}

/** 422 `BUSINESS_RULE_VIOLATION` rule `IMAGE_UNREADABLE` — ảnh hỏng, sharp lỗi / quá 10 s (TL 18/10). */
export function imageUnreadableError(): BusinessRuleViolationError {
  return new BusinessRuleViolationError(
    'IMAGE_UNREADABLE',
    'Ảnh này chưa đọc được, hãy chọn ảnh JPG hoặc PNG khác.',
  );
}
