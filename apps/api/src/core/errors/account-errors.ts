import { AppError, type ErrorCode } from './app-error';
import { UnauthorizedError } from './client-errors';

/**
 * 401 — phiên của người KHÔNG còn thuộc công ty / đã hết `offboard_access_until` (ADR-135, Mốc 3.5), kể cả
 * access token còn hạn. Web coi là hết phiên (về /login), KHÔNG gọi /auth/refresh (chỉ TOKEN_EXPIRED mới refresh).
 */
export class SessionRevokedError extends UnauthorizedError {
  override readonly code: ErrorCode = 'SESSION_REVOKED';

  constructor(message = 'Phiên đăng nhập đã bị thu hồi.') {
    super(message);
  }
}

/** 400 — token kích hoạt sai / rác / không tồn tại: CÙNG một body cho mọi token sai (ADR-137 điều 5). */
export class ActivationInvalidError extends AppError {
  readonly statusCode = 400;
  readonly code: ErrorCode = 'ACTIVATION_INVALID';

  constructor(message = 'Link kích hoạt không hợp lệ.') {
    super(message);
  }
}

/** 410 — token kích hoạt đã dùng / hết hạn / bị thu hồi (ADR-137 điều 5). */
export class ActivationGoneError extends AppError {
  readonly statusCode = 410;
  readonly code: ErrorCode = 'ACTIVATION_GONE';

  constructor(message = 'Link không còn hiệu lực — xin bộ phận nhân sự link mới.') {
    super(message);
  }
}

/**
 * 400 — T-075 (data-retention §5): đơn nghỉ có `reason` mà người gửi CHƯA đồng ý để công ty xử lý lý do nghỉ. Lý do
 * vốn tùy chọn ⇒ bỏ trống thì gửi được; web mời đồng ý ở trang "Quyền riêng tư".
 */
export class LeaveReasonConsentRequiredError extends AppError {
  readonly statusCode = 400;
  readonly code: ErrorCode = 'LEAVE_REASON_CONSENT_REQUIRED';

  constructor() {
    super(
      'Bạn chưa đồng ý để công ty xử lý lý do nghỉ — bỏ trống lý do hoặc đồng ý ở trang Quyền riêng tư.',
    );
  }
}
