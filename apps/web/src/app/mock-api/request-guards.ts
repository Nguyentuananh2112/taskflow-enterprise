import { http, type HttpHandler } from 'msw';

import { OCTET_STREAM_ROUTES } from './avatar-handlers';
import { fail } from './respond';

// Kiểm tra cấp app của API thật (apps/api core/http/middleware.ts), đặt TRƯỚC mọi handler mock.
// T-029 H2: mock dễ dãi hơn server là lý do lỗi thiếu Content-Type lọt qua test — giờ mock trả đúng
// 415 như server.

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);
const UTF8 = new Set(['utf-8', 'utf8']);

/** `invalid` khi có tham số charset trùng lặp hoặc không parse được (server 415 từ T-031). */
function contentType(header: string | null): {
  type: string;
  charset: string | undefined;
  invalid: boolean;
} {
  const [type = '', ...params] = (header ?? '').split(';').map((p) => p.trim().toLowerCase());
  const charsetParams = params.filter((p) => /^charset\s*=/.test(p));
  const charset = charsetParams
    .map((p) => /^charset\s*=\s*"?([^";\s]+)"?$/.exec(p)?.[1])
    .find((c): c is string => c !== undefined);
  const invalid = charsetParams.length > 1 || (charsetParams.length === 1 && charset === undefined);
  return { type, charset, invalid };
}

/**
 * `requireJsonContentType`: POST/PUT/PATCH bắt buộc `application/json` KỂ CẢ khi không có body
 * (ép preflight — chống CSRF, security.md §6.3); JSON chỉ UTF-8. Sai ⇒ 415. Hợp lệ ⇒ đi tiếp.
 */
export function contentTypeGuard(baseUrl: string): HttpHandler {
  return http.all(`${baseUrl}/*`, ({ request }) => {
    const { type, charset, invalid } = contentType(request.headers.get('content-type'));
    // Mốc 6 (ADR-141, B M1): ngoại lệ ĐÚNG cặp method + path — chỉ nhận octet-stream; route khác vẫn 415.
    const path = new URL(request.url).pathname;
    if (OCTET_STREAM_ROUTES.some(([m, re]) => m === request.method && re.test(path))) {
      return type === 'application/octet-stream' ? undefined : fail(415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    const wrongType = METHODS_WITH_BODY.has(request.method) && type !== 'application/json';
    const wrongCharset =
      type === 'application/json' && (invalid || (charset !== undefined && !UTF8.has(charset)));
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

/**
 * Rate limit cửa sổ cố định theo user (mô phỏng RATE_LIMIT_RULES của API): add-member 30/giờ (bù
 * rủi ro dò email qua 404 — security.md §6.5), create-workspace 10/giờ, restore 10/giờ.
 */
export function createRateLimiter(now: () => number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string, limit: number, windowMs = 3_600_000): Response | null => {
    const at = now();
    const entry = hits.get(key);
    const current = entry && entry.resetAt > at ? entry : { count: 0, resetAt: at + windowMs };
    current.count += 1;
    hits.set(key, current);
    if (current.count <= limit) return null;
    const retryAfterSec = Math.ceil((current.resetAt - at) / 1000);
    return fail(
      429,
      'RATE_LIMITED',
      { retryAfterSec },
      { headers: { 'Retry-After': String(retryAfterSec) } },
    );
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
