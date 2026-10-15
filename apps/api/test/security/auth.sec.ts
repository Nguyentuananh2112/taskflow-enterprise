import { SignJWT, decodeJwt } from 'jose';
import { describe, expect } from 'vitest';

import { Actors, refreshCookieOf, type Actor } from './harness/actors';
import { TEST_JWT_SECRET } from './harness/config';
import { errorEnvelope } from './harness/http-client';
import { outOfScope, pendingRoute, useApi } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// Phiên & token (security.md §2–3, SEC-17..27, 32..34, 57). Chờ auth routes (Phase 3).

const api = useApi();
const actors = new Actors(api);
const AUTH = 'auth routes (Phase 3)';
const T020 = 'T-020 Prisma + Valkey (ADR-104/105)';

const me = (token: string) => actors.json('GET', '/auth/me', token);

/** Token giả mạo: bắt đầu từ claim THẬT của `actor`, đổi từng chỗ một. */
async function forge(
  actor: Actor,
  mutate: (claims: Record<string, unknown>) => void,
  secret = TEST_JWT_SECRET,
) {
  const claims: Record<string, unknown> = { ...decodeJwt(actor.accessToken) };
  mutate(claims);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
}

function unsigned(claims: Record<string, unknown>) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}

describe('Refresh token rotation & reuse', () => {
  pendingRoute(
    'SEC-17',
    'Refresh hợp lệ ⇒ 200, token cũ ROTATED, replacedById, cùng familyId',
    AUTH,
  );

  pendingRoute(
    'SEC-18',
    'Dùng lại refresh cũ sau >10s ⇒ 401 + thu hồi cả family + access của sid bị từ chối',
    AUTH,
    async () => {
      const alice = await actors.register('reuse');
      const rotated = await actors.refresh(alice.refreshCookie);
      expect(rotated.status).toBe(200);
      const newest = refreshCookieOf(rotated);
      await new Promise((r) => setTimeout(r, 10_500)); // ân hạn 10s (security.md §2.3)
      const reuse = await actors.refresh(alice.refreshCookie);
      expect(reuse.status).toBe(401);
      expect(errorEnvelope(reuse).error.code).toBe('REFRESH_TOKEN_INVALID');
      expect((await actors.refresh(newest)).status).toBe(401);
      expect((await me(alice.accessToken)).status).toBe(401);
    },
  );

  pendingRoute(
    'SEC-19',
    '2 refresh song song cùng token ⇒ đúng 1 cái 200, 1 cái 409, family không bị thu hồi',
    AUTH,
  );
  pendingRoute('SEC-20', 'Refresh quá expiresAt / familyExpiresAt ⇒ 401', AUTH);
  pendingRoute(
    'SEC-29',
    'Refresh với Origin lạ/thiếu ⇒ 403 ORIGIN_NOT_ALLOWED, token không bị xoay',
    AUTH,
    async () => {
      const alice = await actors.register('origin');
      for (const origin of ['https://evil.example', null]) {
        const res = await actors.refresh(alice.refreshCookie, origin);
        expect(res.status).toBe(403);
        expect(errorEnvelope(res).error.code).toBe('ORIGIN_NOT_ALLOWED');
      }
      expect((await actors.refresh(alice.refreshCookie)).status).toBe(200);
    },
  );
});

describe('Thu hồi phiên', () => {
  pendingRoute('SEC-21', 'Sau logout-all: access cũ ⇒ 401; mọi refresh ⇒ 401', AUTH, async () => {
    const alice = await actors.register('logoutall');
    expect((await actors.json('POST', '/auth/logout-all', alice.accessToken)).status).toBe(204);
    expect((await me(alice.accessToken)).status).toBe(401);
    expect((await actors.refresh(alice.refreshCookie)).status).toBe(401);
  });
  pendingRoute('SEC-22', 'Logout 1 thiết bị: phiên đó 401, phiên khác 200', AUTH);
  pendingRoute('SEC-23', 'Đổi mật khẩu: phiên khác 401, phiên hiện tại token mới 200', AUTH);
  pendingRoute(
    'SEC-24',
    'Logout-all khi Valkey tắt ⇒ access cũ vẫn bị từ chối (fallback DB)',
    AUTH,
  );
  // ADR-105 (A3): ghi thu hồi vào Valkey TRƯỚC commit; lỗi ⇒ 503 + rollback; read-through chỉ SET NX.
  // Cổng nghiệm thu trên branch T-020 (Postgres + Valkey thật). 24b/24d cần container Valkey RIÊNG
  // do suite tự tạo/hủy: SEC-24b ở `valkey-outage.sec.ts`; 24d chưa viết thân.
  pendingRoute(
    'SEC-24c',
    'Đọc xen giữa: cache tv bị xóa (miss) + authenticate song song với logout-all ×20 ⇒ sau 204 access cũ LUÔN 401 (SET NX không đè giá trị thu hồi)',
    T020,
    async () => {
      for (let round = 0; round < 20; round += 1) {
        await flushRateLimitCounters(); // xóa cả `auth:tv:*` ⇒ mọi request kế tiếp là cache miss
        const user = await actors.register(`interleave-${round}`);
        const readers = Array.from({ length: 10 }, () => me(user.accessToken));
        const logoutAll = actors.json('POST', '/auth/logout-all', user.accessToken);
        const [result] = await Promise.all([logoutAll, ...readers]);
        expect(result.status, `vòng ${round}: logout-all`).toBe(204);
        for (let i = 0; i < 3; i += 1) {
          expect((await me(user.accessToken)).status, `vòng ${round}, đọc lại ${i}`).toBe(401);
        }
      }
    },
  );
  pendingRoute(
    'SEC-24d',
    'Ghi trước commit thành công, ghi lại sau commit lỗi (Valkey tắt giữa chừng) rồi hồi phục ⇒ access cũ vẫn 401',
    T020,
  );

  // Findings A4 — lost update trên users: login (đọc → argon2 → save) chạy song song với thao tác
  // bảo mật không được ghi đè ngược passwordHash/tokenVersion. Bộ đếm rate limit (Valkey db 15)
  // được xóa mỗi vòng để 20 lần login không bị 429.
  const login = (email: string, password: string) =>
    actors.json('POST', '/auth/login', undefined, { email, password });

  pendingRoute(
    'SEC-23b',
    'Race login(mật khẩu cũ) ‖ đổi mật khẩu, 20 vòng ⇒ trạng thái cuối khớp đúng bên thắng (mới đúng + cũ sai, hoặc ngược lại khi đổi thua race)',
    `${AUTH} · ${T020}`,
    async () => {
      for (let round = 0; round < 20; round += 1) {
        await flushRateLimitCounters();
        const user = await actors.register(`race-pw-${round}`);
        const newPassword = `brand-new-passphrase-${round}-xyz`;
        const [racingLogin, change] = await Promise.all([
          login(user.email, user.password),
          actors.json('POST', '/auth/change-password', user.accessToken, {
            currentPassword: user.password,
            newPassword,
          }),
        ]);
        const ctx = `vòng ${round} (login song song ${racingLogin.status}, đổi ${change.status})`;
        // ADR-104: đổi mật khẩu thua race (hash đổi giữa verify và UPDATE) ⇒ 400 INVALID_CURRENT_PASSWORD.
        // Mọi status khác là lỗi — không xanh giả. Xóa cache trước khi kiểm ⇒ đọc từ DB.
        if (change.status !== 200) {
          expect(change.status, `${ctx}: ${change.text.slice(0, 200)}`).toBe(400);
          expect(errorEnvelope(change).error.code, ctx).toBe('INVALID_CURRENT_PASSWORD');
        }
        const [winner, loser] =
          change.status === 200 ? [newPassword, user.password] : [user.password, newPassword];
        await flushRateLimitCounters();
        expect((await login(user.email, winner)).status, `${ctx}: mật khẩu bên thắng`).toBe(200);
        expect((await login(user.email, loser)).status, `${ctx}: mật khẩu bên thua`).toBe(401);
      }
    },
  );
  // Ép nhánh "đổi mật khẩu thua race" bằng hộp đen (TL duyệt, thay cho hook trễ trong src): hai lần
  // đổi cùng currentPassword chạy song song — bên sau luôn thua, dù thua ở bước verify hay ở UPDATE
  // có điều kiện `password_hash = oldHash` (ADR-104).
  pendingRoute(
    'SEC-23c',
    '2 change-password song song cùng currentPassword, 20 vòng ⇒ đúng 1×200 + 1×400 INVALID_CURRENT_PASSWORD, chỉ mật khẩu bên thắng đăng nhập được',
    `${AUTH} · ${T020}`,
    async () => {
      for (let round = 0; round < 20; round += 1) {
        await flushRateLimitCounters();
        const user = await actors.register(`race-cp-${round}`);
        const candidates = [`winner-a-passphrase-${round}`, `winner-b-passphrase-${round}`];
        const results = await Promise.all(
          candidates.map((newPassword) =>
            actors.json('POST', '/auth/change-password', user.accessToken, {
              currentPassword: user.password,
              newPassword,
            }),
          ),
        );
        const ctx = `vòng ${round} (${results.map((r) => r.status).join('/')})`;
        expect(results.map((r) => r.status).sort(), ctx).toEqual([200, 400]);
        const loserRes = results.find((r) => r.status === 400);
        expect(loserRes && errorEnvelope(loserRes).error.code, ctx).toBe(
          'INVALID_CURRENT_PASSWORD',
        );
        const winnerIdx = results.findIndex((r) => r.status === 200);
        await flushRateLimitCounters();
        for (const [i, password] of [...candidates, user.password].entries()) {
          const expected = i === winnerIdx ? 200 : 401;
          expect((await login(user.email, password)).status, `${ctx}: mật khẩu #${i}`).toBe(
            expected,
          );
        }
      }
    },
  );
  pendingRoute(
    'SEC-21c',
    'Race login ‖ logout-all, 20 vòng ⇒ access token cấp TRƯỚC logout-all luôn 401 (cả khi cache tv bị xóa ⇒ đọc DB)',
    `${AUTH} · ${T020}`,
    async () => {
      for (let round = 0; round < 20; round += 1) {
        await flushRateLimitCounters();
        const user = await actors.register(`race-tv-${round}`);
        const [, logoutAll] = await Promise.all([
          login(user.email, user.password),
          actors.json('POST', '/auth/logout-all', user.accessToken),
        ]);
        expect(logoutAll.status, `vòng ${round}: logout-all`).toBe(204);
        expect((await me(user.accessToken)).status, `vòng ${round}`).toBe(401);
        // ADR-105 ghi tv mới vào Valkey TRƯỚC commit ⇒ cache che mất lost update trong DB. Xóa cache
        // để lần đọc sau lấy tv từ DB: login song song không được ghi đè ngược token_version (A4).
        await flushRateLimitCounters();
        expect((await me(user.accessToken)).status, `vòng ${round}, đọc DB`).toBe(401);
      }
    },
  );
});

describe('JWT giả mạo', () => {
  pendingRoute(
    'SEC-25',
    'alg none / secret sai / sửa sub / thiếu tv / sai iss, aud ⇒ 401 UNAUTHORIZED',
    AUTH,
    async () => {
      const [alice, bob] = [await actors.register('jwt-a'), await actors.register('jwt-b')];
      const forged = [
        unsigned({ ...decodeJwt(alice.accessToken) }),
        await forge(alice, () => undefined, 'test-only-WRONG-secret-0123456789abcdef'),
        await forge(alice, (c) => (c.sub = bob.userId), 'test-only-WRONG-secret-0123456789abcdef'),
        await forge(alice, (c) => delete c.tv),
        await forge(alice, (c) => (c.iss = 'https://evil.example')),
        await forge(alice, (c) => (c.aud = 'someone-else')),
      ];
      for (const token of forged) {
        const res = await me(token);
        expect(res.status).toBe(401);
        expect(errorEnvelope(res).error.code).toBe('UNAUTHORIZED');
      }
    },
  );
  pendingRoute('SEC-26', 'JWT hết hạn ⇒ 401 TOKEN_EXPIRED', AUTH);
});

describe('Đăng nhập & mật khẩu', () => {
  pendingRoute(
    'SEC-27',
    'Login email lạ vs sai mật khẩu: cùng status/code/message, chênh trung vị < 50ms',
    AUTH,
  );
  pendingRoute(
    'SEC-32',
    'Mật khẩu 11/257 ký tự, phổ biến, chứa email ⇒ 400; 12/256 (cả tiếng Việt) ⇒ 201',
    AUTH,
  );
  pendingRoute(
    'SEC-33',
    'Log của login/refresh/register/change-password không chứa password/token/Cookie/Authorization',
    AUTH,
    async () => {
      const alice = await actors.register('logs');
      await actors.refresh(alice.refreshCookie);
      const logs = api.logs().join('\n');
      expect(logs).not.toContain(alice.password);
      expect(logs).not.toContain(alice.accessToken);
      expect(logs).not.toContain(alice.refreshCookie.split('=')[1] ?? '<none>');
      expect(logs).not.toMatch(/"(authorization|cookie)":/i);
    },
  );
  // SEC-34 (cookie prod, ADR-109 `__Host-tf_rt`) + cookie tossing: `cookie-tossing.sec.ts`.
});

describe('Mass assignment hồ sơ', () => {
  pendingRoute(
    'SEC-57',
    'PATCH /auth/me có email/tokenVersion/id ⇒ 400, không trường nào đổi',
    AUTH,
    async () => {
      const [alice, bob] = [await actors.register('mass-a'), await actors.register('mass-b')];
      for (const extra of [{ email: 'x@evil.example' }, { tokenVersion: 0 }, { id: bob.userId }]) {
        const res = await actors.json('PATCH', '/auth/me', alice.accessToken, {
          fullName: 'Hacked',
          ...extra,
        });
        expect(res.status).toBe(400);
      }
      const after = (await me(alice.accessToken)).json as {
        data: { user: { email: string; fullName: string } };
      };
      expect(after.data.user).toMatchObject({ email: alice.email, fullName: 'Sec mass-a' });
    },
  );
});

describe('Ngoài phạm vi API (Playwright Phase 4/5)', () => {
  outOfScope(
    'SEC-48',
    'CSP nonce khác nhau giữa 2 lần tải; không unsafe-inline/eval',
    'E2E Playwright',
  );
  outOfScope('SEC-49', 'XSS trong title/description hiển thị dạng text', 'E2E Playwright');
  outOfScope(
    'SEC-50',
    'Luồng chính không vi phạm CSP, không token trong storage/URL',
    'E2E Playwright',
  );
});
