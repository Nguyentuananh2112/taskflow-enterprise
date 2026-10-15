import { http, type HttpHandler } from 'msw';

import { fail } from './respond';

// Kiểm tra cấp app của API thật (apps/api core/http/middleware.ts), đặt TRƯỚC mọi handler mock.
// T-029 H2: mock dễ dãi hơn server là lý do lỗi thiếu Content-Type lọt qua test — giờ mock trả đúng
// 415 như server.

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);
const UTF8 = new Set(['utf-8', 'utf8']);

function contentType(header: string | null): { type: string; charset: string | undefined } {
  const [type = '', ...params] = (header ?? '').split(';').map((p) => p.trim().toLowerCase());
  const charset = params
    .map((p) => /^charset\s*=\s*"?([^";\s]+)"?$/.exec(p)?.[1])
    .find((c): c is string => c !== undefined);
  return { type, charset };
}

/**
 * `requireJsonContentType`: POST/PUT/PATCH bắt buộc `application/json` KỂ CẢ khi không có body
 * (ép preflight — chống CSRF, security.md §6.3); JSON chỉ UTF-8. Sai ⇒ 415. Hợp lệ ⇒ đi tiếp.
 */
export function contentTypeGuard(baseUrl: string): HttpHandler {
  return http.all(`${baseUrl}/*`, ({ request }) => {
    const { type, charset } = contentType(request.headers.get('content-type'));
    const wrongType = METHODS_WITH_BODY.has(request.method) && type !== 'application/json';
    const wrongCharset = type === 'application/json' && charset !== undefined && !UTF8.has(charset);
    return wrongType || wrongCharset ? fail(415, 'UNSUPPORTED_MEDIA_TYPE') : undefined;
  });
}

/**
 * `requireAllowedOrigin` cho endpoint dùng cookie (`/auth/refresh`, `/auth/logout`): Origin phải
 * thuộc whitelist, THIẾU Origin cũng 403 `ORIGIN_NOT_ALLOWED`.
 */
export function rejectsOrigin(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
): Response | null {
  const origin = request.headers.get('origin');
  return origin !== null && allowedOrigins.has(origin) ? null : fail(403, 'ORIGIN_NOT_ALLOWED');
}
