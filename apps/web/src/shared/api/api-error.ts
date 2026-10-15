// Lỗi có kiểu cho mọi thất bại của http client. FE rẽ nhánh theo `code` (+ details), không theo
// `message` (data-and-api.md §3.1). `code` là ErrorCode của server, hoặc một trong hai mã phía client.

/** Mã do client tự sinh — không bao giờ đến từ server. */
export const CLIENT_ERROR_CODES = {
  /** fetch ném lỗi: mất mạng, DNS, CORS bị chặn. `status = 0`. */
  network: 'NETWORK_ERROR',
  /** Response không đúng envelope / data không khớp schema contracts. */
  badResponse: 'BAD_RESPONSE',
} as const;

type ApiErrorInit = Readonly<{
  status: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string | undefined;
  cause?: unknown;
}>;

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message, { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }
}

/** `isApiError(err)` hoặc `isApiError(err, 'VERSION_CONFLICT')`. */
export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}
