import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect } from 'vitest';

import { refreshCookieOf, type Actor } from './harness/actors';
import { useCompanyApi } from './harness/company';
import { TEST_JWT_SECRET } from './harness/config';
import { backdateRefreshFamily } from './harness/db-clock';
import { errorEnvelope } from './harness/http-client';
import { outOfScope, secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// Phiên & token (security.md §2–3, SEC-17..27, 32..34, 57). Chờ auth routes (Phase 3).

const { api, actors } = useCompanyApi();
const AUTH = 'auth routes (Phase 3)';
const T020 = 'T-020 Prisma + Valkey (ADR-104/105)';

const me = (token: string) => actors.json('GET', '/auth/me', token);
const sidOf = (token: string) => decodeJwt(token)['sid'];

/** Phiên thứ hai của cùng user (thiết bị khác) qua `POST /auth/login`. */
async function loginAgain(actor: Actor) {
  const res = await actors.json('POST', '/auth/login', undefined, {
    email: actor.email,
    password: actor.password,
  });
  expect(res.status, `login: ${res.text.slice(0, 200)}`).toBe(200);
  return {
    accessToken: (res.json as { data: { accessToken: string } }).data.accessToken,
    refreshCookie: refreshCookieOf(res),
  };
}

const logout = (cookie: string) =>
  api.request({
    method: 'POST',
    path: '/api/v1/auth/logout',
    headers: { 'content-type': 'application/json', origin: api.webOrigin, cookie },
    body: '',
  });

/**
 * Token giả mạo: bắt đầu từ claim VÀ header THẬT của `actor` (gồm `kid` — API từ chối token thiếu
 * `kid` ngay ở bước tra khóa), đổi từng chỗ một ⇒ mỗi biến thể bị từ chối đúng vì chỗ bị đổi.
 */
async function forge(
  actor: Actor,
  mutate: (claims: Record<string, unknown>) => void,
  secret = TEST_JWT_SECRET,
) {
  const claims: Record<string, unknown> = { ...decodeJwt(actor.accessToken) };
  mutate(claims);
  const { kid } = decodeProtectedHeader(actor.accessToken);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', ...(kid ? { kid } : {}) })
    .sign(new TextEncoder().encode(secret));
}

function unsigned(claims: Record<string, unknown>) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}

describe('Refresh token rotation & reuse', () => {
  secCase(
    'SEC-17',
    'Refresh hợp lệ ⇒ 200, token cũ ROTATED, replacedById, cùng familyId',
    AUTH,
    async () => {
      const alice = await actors.register('rotate');
      const res = await actors.refresh(alice.refreshCookie);
      expect(res.status).toBe(200);
      const next = refreshCookieOf(res);
      const access = (res.json as { data: { accessToken: string } }).data.accessToken;
      expect(next, 'cookie mới khác cookie cũ').not.toBe(alice.refreshCookie);
      expect(sidOf(access), 'cùng family (sid = familyId)').toBe(sidOf(alice.accessToken));
      expect((await me(access)).status).toBe(200);
      // Token cũ đã ROTATED (có replacedById): dùng lại trong ân hạn 10s ⇒ 409, không cấp token mới,
      // không thu hồi family — token mới vẫn xoay được.
      const again = await actors.refresh(alice.refreshCookie);
      expect(again.status).toBe(409);
      expect(errorEnvelope(again).error.code).toBe('REFRESH_IN_PROGRESS');
      expect((await actors.refresh(next)).status).toBe(200);
    },
  );

  secCase(
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

  secCase(
    'SEC-19',
    '2 refresh song song cùng token ⇒ đúng 1 cái 200, 1 cái 409, family không bị thu hồi',
    AUTH,
    async () => {
      for (let round = 0; round < 10; round += 1) {
        const alice = await actors.register(`parallel-${round}`);
        const results = await Promise.all([
          actors.refresh(alice.refreshCookie),
          actors.refresh(alice.refreshCookie),
        ]);
        const ctx = `vòng ${round} (${results.map((r) => r.status).join('/')})`;
        expect(results.map((r) => r.status).sort(), ctx).toEqual([200, 409]);
        const loser = results.find((r) => r.status === 409)!;
        expect(errorEnvelope(loser).error.code, ctx).toBe('REFRESH_IN_PROGRESS');
        const winner = results.find((r) => r.status === 200)!;
        expect((await actors.refresh(refreshCookieOf(winner))).status, `${ctx}: family sống`).toBe(
          200,
        );
        expect((await me(alice.accessToken)).status, `${ctx}: access cũ vẫn hợp lệ`).toBe(200);
      }
    },
  );
  secCase('SEC-20', 'Refresh quá expiresAt / familyExpiresAt ⇒ 401', AUTH, async () => {
    for (const column of ['expires_at', 'family_expires_at'] as const) {
      const alice = await actors.register(`expired-${column}`);
      // Ngoại lệ có chủ đích: API không có đồng hồ tua được (harness/db-clock.ts).
      expect(await backdateRefreshFamily(String(sidOf(alice.accessToken)), column), column).toBe(1);
      const res = await actors.refresh(alice.refreshCookie);
      expect(res.status, column).toBe(401);
      expect(errorEnvelope(res).error.code, column).toBe('REFRESH_TOKEN_INVALID');
      // Hết hạn KHÔNG phải reuse ⇒ không thu hồi family / không chặn access còn hạn.
      expect((await me(alice.accessToken)).status, `${column}: access còn hạn`).toBe(200);
    }
  });
  secCase(
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
  secCase('SEC-21', 'Sau logout-all: access cũ ⇒ 401; mọi refresh ⇒ 401', AUTH, async () => {
    const alice = await actors.register('logoutall');
    expect((await actors.json('POST', '/auth/logout-all', alice.accessToken)).status).toBe(204);
    expect((await me(alice.accessToken)).status).toBe(401);
    expect((await actors.refresh(alice.refreshCookie)).status).toBe(401);
  });
  secCase('SEC-22', 'Logout 1 thiết bị: phiên đó 401, phiên khác 200', AUTH, async () => {
    const alice = await actors.register('logout-one');
    const other = await loginAgain(alice);
    expect((await logout(alice.refreshCookie)).status).toBe(204);
    expect((await me(alice.accessToken)).status, 'access của phiên đã logout').toBe(401);
    expect((await actors.refresh(alice.refreshCookie)).status, 'refresh đã logout').toBe(401);
    expect((await me(other.accessToken)).status, 'phiên khác: access').toBe(200);
    expect((await actors.refresh(other.refreshCookie)).status, 'phiên khác: refresh').toBe(200);
  });
  secCase(
    'SEC-23',
    'Đổi mật khẩu: phiên khác 401, phiên hiện tại token mới 200',
    AUTH,
    async () => {
      const alice = await actors.register('change-pw');
      const other = await loginAgain(alice);
      const change = await actors.json('POST', '/auth/change-password', alice.accessToken, {
        currentPassword: alice.password,
        newPassword: 'brand-new-passphrase-sec23',
      });
      expect(change.status, change.text.slice(0, 200)).toBe(200);
      const fresh = (change.json as { data: { accessToken: string } }).data.accessToken;
      const freshCookie = refreshCookieOf(change);
      expect((await me(fresh)).status, 'phiên hiện tại: token mới').toBe(200);
      expect((await actors.refresh(freshCookie)).status, 'phiên hiện tại: refresh mới').toBe(200);
      expect((await me(alice.accessToken)).status, 'access cũ của phiên hiện tại').toBe(401);
      expect((await me(other.accessToken)).status, 'phiên khác: access').toBe(401);
      expect((await actors.refresh(other.refreshCookie)).status, 'phiên khác: refresh').toBe(401);
      expect((await actors.refresh(alice.refreshCookie)).status, 'refresh cũ').toBe(401);
    },
  );
  // SEC-24 nằm ở `valkey-outage.sec.ts` (cần container Valkey riêng để tắt).
  // ADR-105 (A3): ghi thu hồi vào Valkey TRƯỚC commit; lỗi ⇒ 503 + rollback; read-through chỉ SET NX.
  // Cổng nghiệm thu trên branch T-020 (Postgres + Valkey thật). 24b/24d cần container Valkey RIÊNG
  // do suite tự tạo/hủy: SEC-24b ở `valkey-outage.sec.ts`; 24d chưa viết thân.
  secCase(
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
  // Thời điểm tắt Valkey giữa ghi TRƯỚC commit và ghi lại SAU commit không chèn được từ hộp đen ⇒ phủ ở
  // unit (ghi sau commit là best-effort, giá trị trước commit vẫn còn — ADR-105).
  outOfScope(
    'SEC-24d',
    'Ghi trước commit thành công, ghi lại sau commit lỗi (Valkey tắt giữa chừng) rồi hồi phục ⇒ access cũ vẫn 401',
    'unit: logout-all.use-case.test.ts ALL-05 / ADR-105',
  );

  // Findings A4 — lost update trên users: login (đọc → argon2 → save) chạy song song với thao tác
  // bảo mật không được ghi đè ngược passwordHash/tokenVersion. Bộ đếm rate limit (Valkey db 15)
  // được xóa mỗi vòng để 20 lần login không bị 429.
  const login = (email: string, password: string) =>
    actors.json('POST', '/auth/login', undefined, { email, password });

  secCase(
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
  secCase(
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
  secCase(
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
  secCase(
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
  secCase('SEC-26', 'JWT hết hạn ⇒ 401 TOKEN_EXPIRED', AUTH, async () => {
    const alice = await actors.register('expired-jwt');
    const now = Math.floor(Date.now() / 1000);
    // Claim THẬT (tv, sid, iss, aud) ký đúng secret, chỉ lùi exp quá clockTolerance 5s.
    const expired = await forge(alice, (c) => {
      c.iat = now - 960;
      c.exp = now - 60;
    });
    const res = await me(expired);
    expect(res.status).toBe(401);
    expect(errorEnvelope(res).error.code).toBe('TOKEN_EXPIRED');
    // Đối chứng: cùng claim, exp còn hạn ⇒ qua (lỗi trên đúng là do exp).
    const valid = await forge(alice, (c) => {
      c.exp = now + 600;
    });
    expect((await me(valid)).status).toBe(200);
  });
});

describe('Đăng nhập & mật khẩu', () => {
  /** Số dòng `test.argon2_verify` mới (theo target) kể từ `since` — log chỉ có ở APP_ENV=test. */
  const verifiesSince = async (since: number) => {
    const parse = () =>
      api
        .logs()
        .slice(since)
        .flatMap((line) => {
          try {
            const entry = JSON.parse(line) as { msg?: string; target?: string };
            return entry.msg === 'test.argon2_verify' ? [entry.target] : [];
          } catch {
            return [];
          }
        });
    // stdout của API có thể tới sau response ⇒ chờ dòng đầu, rồi thêm một nhịp để bắt dòng thừa.
    const deadline = Date.now() + 5_000;
    while (parse().length === 0 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 150));
    return parse();
  };
  const wrongLogin = async (email: string) => {
    const since = api.logs().length;
    const res = await actors.json('POST', '/auth/login', undefined, {
      email,
      password: 'definitely-wrong-passphrase',
    });
    return { res, verifies: await verifiesSince(since) };
  };

  // Không đo thời gian (CI ồn ⇒ chập chờn): chứng minh trực tiếp nguyên nhân khiến thời gian bằng nhau —
  // email lạ vẫn chạy đúng MỘT lần argon2.verify (trên hash giả), như email có thật sai mật khẩu.
  secCase(
    'SEC-27',
    'Login email lạ vs sai mật khẩu: cùng status/code/message; cả hai chạy đúng 1 lần argon2.verify (hash giả / hash thật)',
    AUTH,
    async () => {
      const alice = await actors.register('enum');
      const unknown = await wrongLogin(`nobody-${Math.random().toString(36).slice(2)}@sec.example`);
      const malformed = await wrongLogin('not-an-email-at-all');
      const wrong = await wrongLogin(alice.email);

      expect(unknown.res.status, 'email lạ').toBe(401);
      expect(wrong.res.status, 'sai mật khẩu').toBe(401);
      expect(errorEnvelope(unknown.res).error).toEqual(errorEnvelope(wrong.res).error);
      expect(unknown.verifies, 'email lạ ⇒ verify hash giả đúng 1 lần').toEqual(['dummy']);
      expect(wrong.verifies, 'sai mật khẩu ⇒ verify hash thật đúng 1 lần').toEqual(['stored']);
      // Email sai định dạng bị schema `LoginBody` chặn (400) TRƯỚC use case: không chạm argon2, và lỗi
      // định dạng không nói gì về việc tài khoản có tồn tại hay không.
      expect(malformed.res.status, malformed.res.text.slice(0, 200)).toBe(400);
      expect(errorEnvelope(malformed.res).error.code).toBe('VALIDATION_ERROR');
      expect(malformed.verifies, 'email sai định dạng ⇒ không verify').toEqual([]);
    },
  );

  // Bản đo thời gian: CHỈ chạy local khi `SEC_TIMING=1` (máy yên). Không đăng ký ca ở chế độ khác ⇒
  // không phải skip/todo (CI không bao giờ thấy ca chập chờn này).
  if (process.env.SEC_TIMING === '1') {
    secCase(
      'SEC-27t',
      'Login email lạ vs sai mật khẩu: chênh trung vị < 50ms (chỉ local, SEC_TIMING=1)',
      AUTH,
      async () => {
        await flushRateLimitCounters(); // 18 lần 401 cùng IP — không cộng dồn với ca trước (login-fail-ip 30)
        const alice = await actors.register('timing');
        const attempt = async (email: string) => {
          const started = performance.now();
          const res = await actors.json('POST', '/auth/login', undefined, {
            email,
            password: 'definitely-wrong-passphrase',
          });
          expect(res.status).toBe(401);
          return performance.now() - started;
        };
        const unknown = () => attempt(`nobody-${Math.random().toString(36).slice(2)}@sec.example`);
        const wrong = () => attempt(alice.email);
        await unknown(); // làm nóng
        await wrong();
        // Tổng 9 lần sai cho email của alice < ngưỡng (IP, email) = 10 (ADR-108).
        const samples = { unknown: [] as number[], wrong: [] as number[] };
        for (let i = 0; i < 8; i += 1) {
          samples.unknown.push(await unknown());
          samples.wrong.push(await wrong());
        }
        const median = (xs: number[]) => {
          const sorted = [...xs].sort((a, b) => a - b);
          const mid = sorted.length / 2;
          return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
        };
        const [mu, mw] = [median(samples.unknown), median(samples.wrong)];
        expect(
          Math.abs(mu - mw),
          `trung vị email lạ ${mu.toFixed(1)} ms vs sai mật khẩu ${mw.toFixed(1)} ms`,
        ).toBeLessThan(50);
      },
    );
  }
  secCase(
    'SEC-32',
    // Mốc 3.5: mật khẩu đặt lần đầu ở `POST auth/activate` (không còn register) — cùng chính sách.
    'Kích hoạt với mật khẩu 11/257 ký tự, phổ biến, chứa email ⇒ 400 (token không bị tiêu); 12/256 (cả tiếng Việt) ⇒ 200',
    'auth/activate (T-061)',
    async () => {
      const activate = (token: string, password: string) =>
        actors.json('POST', '/auth/activate', undefined, { token, password });
      const pending = await actors.createUser('policy', { pending: true });
      const local = pending.email.split('@')[0] ?? ''; // policy kiểm theo TOÀN BỘ phần local của email
      const rejected: [string, string][] = [
        ['ngắn 11', 'abcdefghij1'],
        ['dài 257', `${'y'.repeat(256)}1`],
        ['phổ biến', 'password1234'],
        ['phổ biến (chữ hoa)', 'PASSWORD1234'],
        ['chứa email', `my-${local.toUpperCase()}-pass`],
      ];
      for (const [label, password] of rejected) {
        const res = await activate(pending.token, password);
        expect(res.status, `${label}: ${res.text.slice(0, 200)}`).toBe(400);
        expect(errorEnvelope(res).error.code, label).toBe('VALIDATION_ERROR');
        expect(res.text, `${label}: không phản chiếu mật khẩu (ADR-096)`).not.toContain(password);
      }
      const accepted: [string, string, number][] = [
        ['đúng 12', 'abcdefghijk1', 12],
        ['đúng 256', `${'y'.repeat(255)}1`, 256],
        // 12 KÝ TỰ nhưng > 12 byte UTF-8: đếm theo ký tự (NFC), không theo byte.
        ['tiếng Việt 12 ký tự', 'mậtkhẩuđẹpqá', 12],
      ];
      for (const [i, [label, password, chars]] of accepted.entries()) {
        expect([...password.normalize('NFC')].length, `${label}: dữ liệu test`).toBe(chars);
        // Lần đầu dùng lại token đã bị từ chối 5 lần ⇒ chứng minh mật khẩu sai không tiêu token (B: policy kiểm
        // trước transaction). Hạn mức activation-ip (400/410, 10 lần/15 phút/IP) không chạm: `actors.json` gán
        // IP ngẫu nhiên cho mỗi request chưa xác thực.
        const token =
          i === 0
            ? pending.token
            : (await actors.createUser(`policy-${i}`, { pending: true })).token;
        const res = await activate(token, password);
        expect(res.status, `${label}: ${res.text.slice(0, 200)}`).toBe(200);
      }
    },
  );
  secCase(
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
  secCase(
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

// Cổng T-032 X4 (đọc chéo T-028): refresh ‖ logout-all / change-password không được để lại refresh token
// sống (Y chèn bởi transaction chưa commit, ngoài snapshot của updateMany). Cửa sổ vài ms ⇒ lặp nhiều vòng.
describe('Refresh ‖ thu hồi toàn bộ (X4)', () => {
  const T032 = 'T-032 X4 refresh race';
  const ROUNDS = 40;
  secCase(
    'X4',
    `refresh ‖ logout-all và refresh ‖ change-password ×${String(ROUNDS)} ⇒ không còn refresh token nào sống (trừ phiên mới của change-password)`,
    T032,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await flushRateLimitCounters();
        const user = await actors.register(`x4-${String(round)}`);
        const useChange = round % 2 === 1;
        const [rf, revoke] = await Promise.all([
          actors.refresh(user.refreshCookie),
          useChange
            ? actors.json('POST', '/auth/change-password', user.accessToken, {
                currentPassword: user.password,
                newPassword: `x4-new-passphrase-${String(round)}-xyz`,
              })
            : actors.json('POST', '/auth/logout-all', user.accessToken),
        ]);
        const ctx = `vòng ${String(round)} (${useChange ? 'change-password' : 'logout-all'} ${String(revoke.status)}, refresh ${String(rf.status)})`;
        expect(revoke.status, ctx).toBe(useChange ? 200 : 204);
        await flushRateLimitCounters();
        // Token gốc vừa bị xoay < 10s ⇒ trong ân hạn trả 409 REFRESH_IN_PROGRESS (không cấp gì — §2.3);
        // ngoài ra 401. Không bao giờ 200.
        const original = await actors.refresh(user.refreshCookie);
        expect([401, 409], `${ctx}: token gốc ${String(original.status)}`).toContain(
          original.status,
        );
        if (rf.status === 200) {
          const rotated = await actors.refresh(refreshCookieOf(rf));
          expect(rotated.status, `${ctx}: token xoay trong lúc thu hồi vẫn sống`).toBe(401);
        }
      }
    },
  );
});
