// Gọi API thật để chuẩn bị dữ liệu cho bộ `test:real-api` (không phải code ứng dụng).

export const API = process.env.REAL_API_URL ?? 'http://localhost:4000/api/v1';
/** Origin của "trang" jsdom (http://localhost:3001) — đã whitelist ở API (CORS_ORIGINS). */
export const ORIGIN = window.location.origin;

/* eslint-disable no-restricted-globals -- hạ tầng test gọi API thật trực tiếp để chuẩn bị dữ liệu */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string; clientId?: string },
  parse: (data: unknown) => T,
): Promise<T> {
  const method = init.method ?? 'GET';
  const response = await fetch(API + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      'x-client-id': init.clientId ?? crypto.randomUUID(),
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(init.body ?? {}) }),
  });
  const json: unknown = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path} ⇒ ${response.status} ${JSON.stringify(json)}`);
  return parse(json);
}
/* eslint-enable no-restricted-globals */
