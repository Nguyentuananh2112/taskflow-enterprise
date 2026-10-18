import express, { type Request } from 'express';
import { MemoryStore, type Store } from 'express-rate-limit';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorOf, FakeClock, SpyLogger } from '../../../../test/support';
import { HttpResponder } from '../envelope';
import { globalErrorHandler } from '../error-handler';
import {
  createGlobalRateLimit,
  createHitLimiter,
  createRateLimit,
  createRateLimits,
  hashEmail,
  ipKey,
  type RateLimitDeps,
} from './rate-limit';
import { RATE_LIMIT_RULES, type RateLimitRule } from './rules';

/** Store luôn lỗi — mô phỏng Valkey chết. */
const deadStore = (): Store => ({
  increment: () => Promise.reject(new Error('ECONNREFUSED')),
  decrement: () => Promise.reject(new Error('ECONNREFUSED')),
  resetKey: () => Promise.resolve(),
});

function deps(overrides: Partial<RateLimitDeps> = {}): RateLimitDeps & { logger: SpyLogger } {
  return {
    storeFor: () => new MemoryStore(),
    logger: new SpyLogger(),
    userIdOf: (req: Request) => req.header('x-test-user') ?? undefined,
    ...overrides,
  } as RateLimitDeps & { logger: SpyLogger };
}

function appWith(
  handlers: express.RequestHandler[],
  status: number | ((req: Request) => number) = 200,
) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/t', ...handlers, (_req, res) => {
    res.status(typeof status === 'function' ? status(_req) : status).json({ ok: true });
  });
  app.use(
    globalErrorHandler({
      responder: new HttpResponder(new FakeClock()),
      logger: new SpyLogger(),
      exposeInternalErrors: false,
    }),
  );
  return app;
}

const rule = (r: Partial<RateLimitRule>): RateLimitRule => ({
  id: 'r',
  windowMs: 60_000,
  limit: 2,
  key: 'ip',
  failMode: 'open',
  ...r,
});

describe('createRateLimit', () => {
  it('vượt ngưỡng ⇒ 429 RATE_LIMITED + Retry-After + header RateLimit draft-8', async () => {
    const app = appWith([createRateLimit(rule({ limit: 2 }), deps())]);
    await request(app).post('/t').send({});
    const second = await request(app).post('/t').send({});
    expect(second.headers['ratelimit-policy']).toContain('q=2');
    expect(second.headers['ratelimit']).toContain('r=0');
    const third = await request(app).post('/t').send({});
    expect(third.status).toBe(429);
    expect(errorOf(third)).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: 60 } });
    expect(third.headers['retry-after']).toBe('60');
  });

  it('key theo IP thật sau trust proxy: IP khác ⇒ bộ đếm khác; IPv6 cùng /56 ⇒ chung bộ đếm', async () => {
    const app = appWith([createRateLimit(rule({ limit: 1 }), deps())]);
    const from = (ip: string) => request(app).post('/t').set('X-Forwarded-For', ip).send({});
    expect((await from('203.0.113.1')).status).toBe(200);
    expect((await from('203.0.113.1')).status).toBe(429);
    expect((await from('203.0.113.2')).status).toBe(200);
    expect((await from('2001:db8:aa:bb01::1')).status).toBe(200);
    expect((await from('2001:db8:aa:bbff::9')).status).toBe(429); // cùng /56
  });

  it('key theo user (đã xác thực) và rơi về IP khi chưa xác thực', async () => {
    const app = appWith([createRateLimit(rule({ key: 'user', limit: 1 }), deps())]);
    expect((await request(app).post('/t').set('x-test-user', 'mia').send({})).status).toBe(200);
    expect((await request(app).post('/t').set('x-test-user', 'mia').send({})).status).toBe(429);
    expect((await request(app).post('/t').set('x-test-user', 'pam').send({})).status).toBe(200);
    expect((await request(app).post('/t').send({})).status).toBe(200);
    expect((await request(app).post('/t').send({})).status).toBe(429);
  });

  it('login: chỉ đếm lần SAI, theo (IP, email băm) — email khác hoa/thường vẫn chung bộ đếm', async () => {
    const d = deps();
    const failing = appWith(
      createRateLimits([rule({ key: 'ip+email', limit: 2, countFailedOnly: true })], d),
      401,
    );
    const ok = appWith(
      createRateLimits([rule({ key: 'ip+email', limit: 2, countFailedOnly: true })], d),
      200,
    );
    for (let i = 0; i < 5; i++)
      expect((await request(ok).post('/t').send({ email: 'mia@example.com' })).status).toBe(200);
    await request(failing).post('/t').send({ email: 'Mia@Example.com ' });
    await request(failing).post('/t').send({ email: 'mia@example.com' });
    expect((await request(failing).post('/t').send({ email: 'mia@example.com' })).status).toBe(429);
    expect((await request(failing).post('/t').send({ email: 'pam@example.com' })).status).toBe(401);
  });

  it('fail-closed (login/register/refresh): Valkey chết ⇒ 503 SERVICE_UNAVAILABLE, handler không chạy', async () => {
    const d = deps({ storeFor: deadStore });
    const app = appWith(createRateLimits(RATE_LIMIT_RULES.login, d));
    const res = await request(app).post('/t').send({ email: 'mia@example.com', password: 'x' });
    expect(res.status).toBe(503);
    expect(errorOf(res).code).toBe('SERVICE_UNAVAILABLE');
    expect(d.logger.messages('error')).toContain('rate_limit.store_unavailable_fail_closed');
  });

  it('fail-open (phần còn lại): Valkey chết ⇒ cho qua, cảnh báo tối đa 1 lần/30s', async () => {
    const clock = new FakeClock();
    const d = deps({ storeFor: deadStore, now: () => clock.now().getTime() });
    const app = appWith(
      [createRateLimit(rule({ failMode: 'open', limit: 1, countFailedOnly: true }), d)],
      400,
    );
    for (let i = 0; i < 3; i++) expect((await request(app).post('/t').send({})).status).toBe(400);
    expect(d.logger.messages('warn')).toEqual(['rate_limit.store_unavailable_fail_open']);
    clock.advance(30_001);
    await request(app).post('/t').send({});
    expect(d.logger.messages('warn')).toHaveLength(2);
  });

  it('mỗi route chọn rule từ bảng security §6.4; activation/refresh cũng fail-closed', () => {
    expect(RATE_LIMIT_RULES.loginIp.map((r) => [r.id, r.limit, r.windowMs])).toEqual([
      ['login-ip', 300, 900_000],
    ]);
    // ADR-108: chỉ đếm 401, (IP, email) 10/15 phút, email 100/giờ.
    expect(
      RATE_LIMIT_RULES.login.map((r) => [r.id, r.limit, r.windowMs, r.countOnlyStatuses]),
    ).toEqual([
      ['login-fail-ip-email', 10, 900_000, [401]],
      ['login-fail-email', 100, 3_600_000, [401]],
      ['login-fail-ip', 50, 900_000, [401]],
    ]);
    // Lỗi #2 localhost: cả văn phòng chung IP NAT ⇒ handshake 600/phút/IP, Valkey lỗi ⇒ cho qua.
    expect(
      RATE_LIMIT_RULES.socketHandshake.map((r) => [r.id, r.limit, r.windowMs, r.key, r.failMode]),
    ).toEqual([['socket-handshake-ip', 600, 60_000, 'ip', 'open']]);
    // Mốc 6: `avatar` fail-closed có chủ đích (tốn đĩa + CPU worker sharp — B).
    const closed = [
      'login',
      'loginIp',
      'activation',
      'refresh',
      'changePassword',
      'avatar',
      'chatUpload',
    ] as const;
    for (const name of closed) {
      expect(RATE_LIMIT_RULES[name].every((r) => r.failMode === 'closed')).toBe(true);
    }
    const others = Object.entries(RATE_LIMIT_RULES).filter(
      ([n]) => !(closed as readonly string[]).includes(n),
    );
    expect(others.flatMap(([, rules]) => rules).every((r) => r.failMode === 'open')).toBe(true);
    const ids = Object.values(RATE_LIMIT_RULES).flatMap((rules) => rules.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('một văn phòng chung một IP NAT (T-076, lỗi #2 localhost)', () => {
  it('mọi luật theo IP đo cho văn phòng ~200 người; luật chống dò theo (IP, email) / email giữ chặt', () => {
    const ipRules = Object.values(RATE_LIMIT_RULES)
      .flat()
      .filter((r) => r.key === 'ip')
      .map((r) => [r.id, r.limit, r.windowMs]);
    expect(ipRules).toEqual([
      ['login-ip', 300, 900_000],
      ['login-fail-ip', 50, 900_000], // chỉ đếm 401 — chống password spraying (soát B M1)
      ['activation-ip', 10, 900_000], // chỉ đếm lần sai (400 / 410)
      ['refresh-ip', 1200, 300_000],
      ['logout-ip', 120, 60_000],
      ['api-ip', 600, 60_000],
      ['api-bearer-ip', 3000, 60_000],
      ['api-auth-fail-ip', 300, 60_000],
      ['socket-handshake-ip', 600, 60_000],
      ['media-ip', 2000, 60_000],
    ]);
    expect(RATE_LIMIT_RULES.login.map((r) => r.limit)).toEqual([10, 100, 50]);
  });

  it('login-fail-ip (soát B M1): 300 lần đăng nhập ĐÚNG không tốn suất; lần sai thứ 51 trên 51 email khác nhau ⇒ 429', async () => {
    const d = deps();
    const ok = appWith(createRateLimits(RATE_LIMIT_RULES.login, d));
    for (let i = 0; i < 300; i++) {
      const res = await request(ok)
        .post('/t')
        .send({ email: `nv${i}@example.com` });
      expect(res.status, `đúng lần ${i + 1}`).toBe(200);
    }
    // Cùng một app (cùng bucket): body `ok` ⇒ handler trả 200 (đăng nhập đúng), còn lại 401.
    const failing = appWith(createRateLimits(RATE_LIMIT_RULES.login, deps()), (req) =>
      (req.body as { ok?: boolean }).ok ? 200 : 401,
    );
    for (let i = 0; i < 50; i++) {
      const res = await request(failing)
        .post('/t')
        .send({ email: `spray${i}@example.com` });
      expect(res.status, `sai lần ${i + 1}`).toBe(401);
    }
    const blocked = await request(failing).post('/t').send({ email: 'spray50@example.com' });
    expect(blocked.status).toBe(429);
    // Soát B: bucket ĐẦY ⇒ cả lần đăng nhập ĐÚNG (handler sẽ trả 200) cũng 429 — chặn trước khi kiểm mật khẩu.
    const right = await request(failing).post('/t').send({ email: 'nv0@example.com', ok: true });
    expect(right.status).toBe(429);
  });

  it('login-ip: 300 lần đăng nhập từ cùng IP trong 15 phút đều qua; lần 301 ⇒ 429', async () => {
    const app = appWith(createRateLimits(RATE_LIMIT_RULES.loginIp, deps()));
    for (let i = 0; i < 300; i++) {
      expect((await request(app).post('/t').send({})).status, `lần ${i + 1}`).toBe(200);
    }
    expect((await request(app).post('/t').send({})).status).toBe(429);
  });
});

describe('createGlobalRateLimit & helpers', () => {
  /** App mô phỏng `authenticate`: `Bearer good` ⇒ 200, token khác ⇒ 401; không token ⇒ 200 (public). */
  function guardedApp(
    limits: { anonymous?: number; bearerIp?: number; authFailure?: number } = {},
  ) {
    const app = express();
    app.set('trust proxy', 1);
    app.use(
      ...createGlobalRateLimit(deps(), {
        anonymous: rule({ id: 'anon', limit: limits.anonymous ?? 100 }),
        bearerIp: rule({ id: 'bearer', limit: limits.bearerIp ?? 1000 }),
        authFailure: rule({
          id: 'auth-fail',
          limit: limits.authFailure ?? 30,
          countOnlyStatuses: [401],
        }),
      }),
    );
    app.get('/r', (req, res) => {
      const auth = req.headers.authorization;
      res.sendStatus(auth === undefined || auth === 'Bearer good' ? 200 : 401);
    });
    app.get('/forbidden', (_req, res) => {
      res.sendStatus(403);
    });
    app.use(
      globalErrorHandler({
        responder: new HttpResponder(new FakeClock()),
        logger: new SpyLogger(),
        exposeInternalErrors: false,
      }),
    );
    return app;
  }

  it('không có token: 100/phút/IP', async () => {
    const app = guardedApp({ anonymous: 2 });
    expect((await request(app).get('/r')).status).toBe(200);
    expect((await request(app).get('/r')).status).toBe(200);
    expect((await request(app).get('/r')).status).toBe(429);
  });

  it('review T-016: "Authorization: Bearer garbage" KHÔNG né được giới hạn IP — hết suất 401 ⇒ 429', async () => {
    const app = guardedApp({ authFailure: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/r').set('Authorization', 'Bearer garbage')).status).toBe(
        401,
      );
    }
    const blocked = await request(app).get('/r').set('Authorization', 'Bearer garbage');
    expect(blocked.status).toBe(429);
    expect(errorOf(blocked).code).toBe('RATE_LIMITED');
    // IP đã bị chặn cho mọi request có token trong cửa sổ (kẻ tấn công không xoay token để né).
    expect((await request(app).get('/r').set('Authorization', 'Bearer other-garbage')).status).toBe(
      429,
    );
    // IP khác không bị ảnh hưởng.
    expect(
      (
        await request(app)
          .get('/r')
          .set('X-Forwarded-For', '198.51.100.9')
          .set('Authorization', 'Bearer good')
      ).status,
    ).toBe(200);
  });

  it('bucket 401 chỉ đếm 401 — token hợp lệ (200) và lỗi khác (403) không bị tính', async () => {
    const app = guardedApp({ authFailure: 2 });
    for (let i = 0; i < 5; i++) {
      expect((await request(app).get('/r').set('Authorization', 'Bearer good')).status).toBe(200);
      expect(
        (await request(app).get('/forbidden').set('Authorization', 'Bearer good')).status,
      ).toBe(403);
    }
  });

  it('có token: trần thô theo IP (1000/phút) vẫn áp dụng cho token hợp lệ', async () => {
    const app = guardedApp({ bearerIp: 2 });
    expect((await request(app).get('/r').set('Authorization', 'Bearer good')).status).toBe(200);
    expect((await request(app).get('/r').set('Authorization', 'Bearer good')).status).toBe(200);
    expect((await request(app).get('/r').set('Authorization', 'Bearer good')).status).toBe(429);
    // bucket không-token tách riêng
    expect((await request(app).get('/r')).status).toBe(200);
  });

  it('bảng mặc định: 600 / 3000 / 300 lần 401 mỗi phút theo IP', () => {
    expect([
      RATE_LIMIT_RULES.anonymous[0].limit,
      RATE_LIMIT_RULES.bearerIp[0].limit,
      RATE_LIMIT_RULES.authFailure[0].limit,
    ]).toEqual([600, 3000, 300]);
    expect(RATE_LIMIT_RULES.authFailure[0].countOnlyStatuses).toEqual([401]);
    expect(createGlobalRateLimit(deps())).toHaveLength(3);
  });

  it('hashEmail: SHA-256 của email chuẩn hóa, không lộ email; thiếu email ⇒ hằng số', () => {
    expect(hashEmail(' Mia@Example.COM ')).toBe(hashEmail('mia@example.com'));
    expect(hashEmail('mia@example.com')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail(undefined)).toBe('no-email');
    expect(hashEmail(42)).toBe('no-email');
  });

  it('ipKey: IPv4 giữ nguyên, IPv6 gom /56, thiếu IP ⇒ 0.0.0.0', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('2001:db8:aa:bb01::1')).toBe(ipKey('2001:db8:aa:bbff::2'));
    expect(ipKey(undefined)).toBe('0.0.0.0');
  });
});

describe('createHitLimiter (handshake Socket.io)', () => {
  it('đếm theo key, vượt ngưỡng ⇒ allowed=false kèm retryAfter', async () => {
    const limiter = createHitLimiter(rule({ limit: 2 }), {
      storeFor: () => new MemoryStore(),
      logger: new SpyLogger(),
    });
    expect((await limiter.hit('1.1.1.1')).allowed).toBe(true);
    expect((await limiter.hit('1.1.1.1')).allowed).toBe(true);
    expect(await limiter.hit('1.1.1.1')).toMatchObject({ allowed: false });
    expect((await limiter.hit('1.1.1.1')).retryAfterSec).toBeGreaterThan(0);
    expect((await limiter.hit('2.2.2.2')).allowed).toBe(true);
  });

  it('store lỗi: open ⇒ cho qua; closed ⇒ ném 503', async () => {
    const open = createHitLimiter(rule({ failMode: 'open' }), {
      storeFor: deadStore,
      logger: new SpyLogger(),
    });
    expect((await open.hit('k')).allowed).toBe(true);
    const closed = createHitLimiter(rule({ failMode: 'closed' }), {
      storeFor: deadStore,
      logger: new SpyLogger(),
    });
    await expect(closed.hit('k')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
