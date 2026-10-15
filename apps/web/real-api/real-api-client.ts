import { LoginResponse } from '@taskflow/contracts/auth';
import { apiSuccess } from '@taskflow/contracts/common';

// Gọi API thật để chuẩn bị dữ liệu cho bộ `test:real-api` (không phải code ứng dụng).

export const API = process.env.REAL_API_URL ?? 'http://localhost:4000/api/v1';
/** Origin của "trang" jsdom (http://localhost:3001) — đã whitelist ở API (CORS_ORIGINS). */
export const ORIGIN = window.location.origin;

/** Mật khẩu tài khoản dev trên DB local — CHỈ đọc từ env (không có giá trị mặc định trong repo). */
export const PASSWORD = process.env.REAL_API_PASSWORD;

/* eslint-disable no-restricted-globals -- hạ tầng test gọi API thật trực tiếp để chuẩn bị dữ liệu */
/** Gọi API, trả nguyên status + body (dùng cho các ca server TỪ CHỐI). */
export async function apiRaw(
  path: string,
  init: { method?: string; body?: unknown; token?: string; clientId?: string },
): Promise<{ status: number; json: unknown }> {
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
  return { status: response.status, json: (await response.json()) as unknown };
}
/* eslint-enable no-restricted-globals */

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string; clientId?: string },
  parse: (data: unknown) => T,
): Promise<T> {
  const { status, json } = await apiRaw(path, init);
  if (status >= 400) {
    throw new Error(`${init.method ?? 'GET'} ${path} ⇒ ${status} ${JSON.stringify(json)}`);
  }
  return parse(json);
}

/**
 * Đăng nhập; chưa có tài khoản (401) ⇒ đăng ký rồi đăng nhập. Lỗi khác (vd 429 rate-limit) ném
 * thẳng ra — không che bằng một lần đăng ký vô ích.
 */
export async function loginOrRegister(email: string, fullName: string) {
  const password = PASSWORD ?? '';
  const login = () =>
    api(
      '/auth/login',
      { method: 'POST', body: { email, password } },
      (j) => apiSuccess(LoginResponse).parse(j).data,
    );
  const first = await apiRaw('/auth/login', { method: 'POST', body: { email, password } });
  if (first.status === 200) return apiSuccess(LoginResponse).parse(first.json).data;
  if (first.status !== 401) {
    throw new Error(`POST /auth/login ⇒ ${first.status} ${JSON.stringify(first.json)}`);
  }
  await api('/auth/register', { method: 'POST', body: { email, password, fullName } }, (j) => j);
  return login();
}
