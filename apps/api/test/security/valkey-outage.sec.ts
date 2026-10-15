import { afterAll, beforeAll, describe, expect } from 'vitest';

import { Actors, refreshCookieOf } from './harness/actors';
import { errorEnvelope } from './harness/http-client';
import { pendingRoute, runPending, useApi } from './harness/suite';
import { startTempValkey, type TempValkey } from './harness/valkey-container';

// Valkey sự cố (security.md §2.4, ADR-105 / findings A3). File riêng vì process API trỏ vào một container
// Valkey TẠM mà test được giết/bật lại — không bao giờ đụng Valkey compose dùng chung (TEAM.md).
// Thứ tự hook: beforeAll này chạy TRƯỚC beforeAll của useApi ⇒ REDIS_URL đã có khi API khởi động;
// afterAll chạy ngược (stack) ⇒ dừng API rồi mới xóa container.

const T020 = 'T-020 Prisma + Valkey (ADR-104/105)';
const T032 = 'T-032 sid-revoked fallback DB khi cache miss';
/** kill + start container + chờ API nối lại (backoff ≤ 5s): máy dev tải nặng vượt 20s mặc định. */
const RESTART_TIMEOUT_MS = 120_000;
const env: Record<string, string> = {};
let valkey: TempValkey | undefined;

beforeAll(async () => {
  if (!runPending(T020) && !runPending(T032)) return; // case bị skip ⇒ không dựng container cho tốn RAM
  valkey = await startTempValkey();
  env.REDIS_URL = valkey.url;
}, 120_000);

afterAll(() => {
  valkey?.remove();
});

const api = useApi(env);
const actors = new Actors(api);
const me = (token: string) => actors.json('GET', '/auth/me', token);

/** Chờ API nối lại Valkey (backoff ≤ 5s) — `/readyz` báo `valkey` hết `degraded`. */
async function waitValkeyReconnected(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await api.request({ method: 'GET', path: '/readyz' });
    if (res.status === 200 && !res.text.includes('degraded')) return;
    if (Date.now() > deadline) throw new Error(`API chưa nối lại Valkey: ${res.text}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('Valkey sự cố', () => {
  pendingRoute(
    'SEC-24b',
    'Valkey lỗi khi ghi thu hồi TRƯỚC commit ⇒ 503, rollback (tv/mật khẩu không đổi trong DB)',
    T020,
    async () => {
      if (!valkey) throw new Error('container Valkey tạm chưa dựng');
      const user = await actors.register('valkey-down');
      const newPassword = `never-applied-${user.userId.slice(0, 8)}-passphrase`;

      valkey.kill();
      // Đối chứng: xác thực khi Valkey chết vẫn qua (đọc fallback DB — SEC-24). Nếu không, 503 bên dưới
      // có thể đến từ bước xác thực chứ không phải bước ghi thu hồi ⇒ xanh giả.
      expect((await me(user.accessToken)).status, 'đối chứng /auth/me khi Valkey chết').toBe(200);

      const logoutAll = await actors.json('POST', '/auth/logout-all', user.accessToken);
      expect(logoutAll.status, `logout-all: ${logoutAll.text.slice(0, 200)}`).toBe(503);
      expect(errorEnvelope(logoutAll).error.code).toBe('SERVICE_UNAVAILABLE');

      const change = await actors.json('POST', '/auth/change-password', user.accessToken, {
        currentPassword: user.password,
        newPassword,
      });
      expect(change.status, `change-password: ${change.text.slice(0, 200)}`).toBe(503);
      expect(errorEnvelope(change).error.code).toBe('SERVICE_UNAVAILABLE');

      // Bật lại với cache TRỐNG ⇒ mọi kiểm tra sau đọc tv / hash từ DB: rollback phải trọn vẹn.
      await valkey.restart();
      await waitValkeyReconnected();
      expect((await me(user.accessToken)).status, 'tv trong DB không đổi').toBe(200);
      const refreshed = await actors.refresh(user.refreshCookie);
      expect(refreshed.status, 'refresh family không bị thu hồi').toBe(200);
      refreshCookieOf(refreshed);
      const login = (password: string) =>
        actors.json('POST', '/auth/login', undefined, { email: user.email, password });
      expect((await login(user.password)).status, 'mật khẩu cũ vẫn đúng').toBe(200);
      expect((await login(newPassword)).status, 'mật khẩu mới không được ghi').toBe(401);
    },
    RESTART_TIMEOUT_MS,
  );

  // Cổng T-032 (đọc chéo T-028 X3): `sid-revoked` chỉ sống trong Valkey (không persistence). Cache miss
  // `tv` sau restart không được coi phiên đã thu hồi là sống — phải hỏi DB (`isSessionRevoked`).
  pendingRoute(
    'SEC-24e',
    'Logout 1 thiết bị ⇒ Valkey restart (mất sid-revoked) ⇒ access token của phiên đó vẫn 401 (đọc DB)',
    T032,
    async () => {
      if (!valkey) throw new Error('container Valkey tạm chưa dựng');
      await waitValkeyReconnected();
      const user = await actors.register('sid-restart');
      const other = await actors.json('POST', '/auth/login', undefined, {
        email: user.email,
        password: user.password,
      });
      expect(other.status).toBe(200);
      const otherToken = (other.json as { data: { accessToken: string } }).data.accessToken;

      const logout = await api.request({
        method: 'POST',
        path: '/api/v1/auth/logout',
        headers: {
          'content-type': 'application/json',
          origin: api.webOrigin,
          cookie: user.refreshCookie,
        },
        body: '',
      });
      expect(logout.status).toBe(204);
      expect((await me(user.accessToken)).status, 'ngay sau logout').toBe(401);

      valkey.kill();
      await valkey.restart(); // cache trống: không còn auth:sid-revoked / auth:tv
      await waitValkeyReconnected();
      expect((await me(user.accessToken)).status, 'phiên đã logout sau Valkey restart').toBe(401);
      expect((await me(otherToken)).status, 'đối chứng: phiên khác vẫn sống').toBe(200);
    },
    RESTART_TIMEOUT_MS,
  );

  pendingRoute(
    'SEC-24f',
    'Hai phiên S1, S2; logout S1 ⇒ Valkey restart ⇒ S2 gọi TRƯỚC (nạp lại tv) ⇒ S1 vẫn 401',
    T032,
    async () => {
      if (!valkey) throw new Error('container Valkey tạm chưa dựng');
      await waitValkeyReconnected();
      const user = await actors.register('sid-prime');
      const s2 = await actors.json('POST', '/auth/login', undefined, {
        email: user.email,
        password: user.password,
      });
      expect(s2.status).toBe(200);
      const s2Token = (s2.json as { data: { accessToken: string } }).data.accessToken;
      const logout = await api.request({
        method: 'POST',
        path: '/api/v1/auth/logout',
        headers: {
          'content-type': 'application/json',
          origin: api.webOrigin,
          cookie: user.refreshCookie,
        },
        body: '',
      });
      expect(logout.status).toBe(204);

      valkey.kill();
      await valkey.restart();
      await waitValkeyReconnected();
      expect((await me(s2Token)).status, 'S2 gọi trước, nạp lại cache tv').toBe(200);
      expect((await me(user.accessToken)).status, 'S1 đã logout vẫn bị từ chối').toBe(401);
    },
    RESTART_TIMEOUT_MS,
  );
});
