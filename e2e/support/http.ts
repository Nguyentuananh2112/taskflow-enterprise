import type { APIRequestContext } from '@playwright/test';

import { API_URL, WEB_ORIGIN } from './env';

// Seed dữ liệu CHỈ qua API công khai (T-026 mục 1) — không chọc DB. Origin + JSON như trình duyệt thật
// (CSRF/415 của API). Mỗi lời gọi trả lỗi rõ khi status sai để test không đỏ mơ hồ.

export async function call<T>(
  request: APIRequestContext,
  method: string,
  path: string,
  token: string | undefined,
  body: unknown,
  expected: number,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, {
    method,
    headers: {
      origin: WEB_ORIGIN,
      // GET không có body (body rỗng + JSON ⇒ 400 invalid_json); POST/PATCH bắt buộc JSON (415).
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    // Không có body ⇒ không gửi `data` (chuỗi rỗng bị coi là JSON hỏng ⇒ 400 invalid_json).
    ...(method === 'GET' || body === undefined ? {} : { data: JSON.stringify(body) }),
  });
  if (res.status() !== expected) {
    throw new Error(
      `${method} ${path} — mong đợi ${String(expected)}, nhận ${String(res.status())}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return ((await res.json()) as { data: T }).data;
}
