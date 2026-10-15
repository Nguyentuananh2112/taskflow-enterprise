import type { ErrorCode } from '@taskflow/contracts/common';

// Lỗi có kiểu cho mọi thất bại của http client. FE rẽ nhánh theo `code` (+ details), không theo
// `message` (data-and-api.md §3.1). `code` là ErrorCode của server, hoặc một trong hai mã phía client.

/** Mã do client tự sinh — không bao giờ đến từ server. */
export const CLIENT_ERROR_CODES = {
  /** fetch ném lỗi: mất mạng, DNS, CORS bị chặn. `status = 0`. */
  network: 'NETWORK_ERROR',
  /** Body không phải envelope hợp lệ / data không khớp schema contracts. */
  badResponse: 'BAD_RESPONSE',
  /**
   * ADR-102: envelope lỗi hợp lệ nhưng `error.code` chưa có trong ErrorCode (API deploy trước web).
   * Giữ `status` + `message`; FE xử lý như lỗi chung theo HTTP status. Mã gốc ở `serverCode`.
   */
  unknown: 'UNKNOWN_ERROR',
} as const;

export type ApiErrorCode = ErrorCode | (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES];

type ApiErrorInit = Readonly<{
  status: number;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
  requestId?: string | undefined;
  /** Mã gốc server gửi khi `code = UNKNOWN_ERROR` (để log/tra cứu, không để rẽ nhánh). */
  serverCode?: string | undefined;
  cause?: unknown;
}>;

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  readonly requestId: string | undefined;
  readonly serverCode: string | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message, { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.serverCode = init.serverCode;
  }
}

/** `isApiError(err)` hoặc `isApiError(err, 'VERSION_CONFLICT')`. */
export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}
