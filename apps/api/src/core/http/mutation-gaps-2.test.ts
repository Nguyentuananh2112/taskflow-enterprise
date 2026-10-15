// Đợt 2 test theo Stryker core-http sau T-024 (78.5%): chỉ survivor có hành vi quan sát được.
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';

import express, { type Request } from 'express';
import { MemoryStore, type Store } from 'express-rate-limit';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { FakeClock, SpyLogger } from '../../../test/support';
import { createLogger } from '../logging/pino-logger';
import { HttpResponder } from './envelope';
import { globalErrorHandler } from './error-handler';
import { parseContentType, requestLogging, requireAllowedOrigin } from './middleware';
import { afterFromCursor, pageMeta } from './pagination';
import { createRateLimit, createHitLimiter, hashEmail } from './rate-limit/rate-limit';
import type { RateLimitRule } from './rate-limit/rules';
import { FailModeStore, ResilientRedisStore } from './rate-limit/store';
import { clientIdOf, requireUser, sessionMetaOf } from './request-user';
import { validate } from './validate';

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962';
const reqWith = (headers: Record<string, string | string[]>, extra: object = {}) =>
  ({ headers, ...extra }) as unknown as Request;

describe('pagination: cursor opaque ↔ after/nextAfter', () => {
  it('khứ hồi; kind gắn với endpoint; null ⇒ hết trang', () => {
    const meta = pageMeta('members', UUID, 10);
    expect(meta).toMatchObject({ hasMore: true, limit: 10 });
    expect(afterFromCursor('members', meta.nextCursor ?? undefined)).toBe(UUID);
    expect(() => afterFromCursor('projects', meta.nextCursor ?? undefined)).toThrow();
    expect(pageMeta('members', null, 10)).toEqual({ nextCursor: null, hasMore: false, limit: 10 });
    expect(afterFromCursor('members', undefined)).toBeUndefined();
  });
});

describe('request-user', () => {
  it('requireUser: thiếu user ⇒ 401 UnauthorizedError; có ⇒ trả user', () => {
    expect(() => requireUser(reqWith({}))).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
    expect(requireUser(reqWith({}, { user: { id: 'u', sid: 's' } }))).toEqual({
      id: 'u',
      sid: 's',
    });
  });

  it('X-Client-Id: uuid (chuẩn hóa chữ thường), lấy phần tử đầu; không phải uuid / bọc rác ⇒ null', () => {
    expect(clientIdOf(reqWith({ 'x-client-id': UUID.toUpperCase() }))).toBe(UUID);
    expect(clientIdOf(reqWith({ 'x-client-id': [UUID, 'x'] }))).toBe(UUID);
    for (const bad of ['', 'abc', `x${UUID}`, `${UUID}x`]) {
      expect(clientIdOf(reqWith({ 'x-client-id': bad }))).toBeNull();
    }
    expect(clientIdOf(reqWith({}))).toBeNull();
  });

  it('sessionMeta: User-Agent cắt 255 ký tự, IP từ req.ip; thiếu ⇒ null', () => {
    expect(
      sessionMetaOf(reqWith({ 'user-agent': 'a'.repeat(300) }, { ip: '203.0.113.7' })),
    ).toEqual({
      userAgent: 'a'.repeat(255),
      ip: '203.0.113.7',
    });
    expect(sessionMetaOf(reqWith({}))).toEqual({ userAgent: null, ip: null });
  });
});

describe('parseContentType / Origin', () => {
  it.each([
    [undefined, { type: '' }],
    ['application/json', { type: 'application/json' }],
    ['Application/JSON; Charset="UTF-8"', { type: 'application/json', charset: 'utf-8' }],
    ['application/json; foo=bar; charset=utf8', { type: 'application/json', charset: 'utf8' }],
    ['application/json; xcharset=utf-16', { type: 'application/json' }],
    ['application/json; charset=utf-16 extra', { type: 'application/json', ambiguous: true }],
    // Hồi quy (lộ ra nhờ đột biến): regex T-021 mất dấu \ ⇒ "\s" thành chữ "s".
    ['application/json; charset = utf-16le', { type: 'application/json', charset: 'utf-16le' }],
    ['application/json; charset=us-ascii', { type: 'application/json', charset: 'us-ascii' }],
  ])('%s ⇒ %j', (header, expected) => {
    expect(parseContentType(header)).toEqual(expected);
  });

  it('requireAllowedOrigin: chỉ Origin trong whitelist; thiếu/lạ ⇒ 403', async () => {
    const a = express();
    a.post('/r', requireAllowedOrigin(['https://app.example.com']), (_req, res) => {
      res.sendStatus(204);
    });
    a.use(
      globalErrorHandler({
        responder: new HttpResponder(new FakeClock()),
        logger: new SpyLogger(),
        exposeInternalErrors: false,
      }),
    );
    expect((await request(a).post('/r').set('Origin', 'https://app.example.com')).status).toBe(204);
    expect((await request(a).post('/r').set('Origin', 'https://evil.example')).status).toBe(403);
    expect((await request(a).post('/r')).status).toBe(403);
  });

  it('validate thay giá trị bằng thuộc tính enumerable + configurable (không giấu khỏi log/serializer)', async () => {
    let descriptor: PropertyDescriptor | undefined;
    const a = express();
    a.get('/r', validate({ query: z.object({ n: z.coerce.number() }) }), (req, res) => {
      descriptor = Object.getOwnPropertyDescriptor(req, 'query');
      res.json(req.query);
    });
    expect((await request(a).get('/r?n=5')).body).toEqual({ n: 5 });
    expect(descriptor).toMatchObject({ enumerable: true, configurable: true, writable: true });
  });
});

describe('pino-http: health không log, mức log theo biên 400/500', () => {
  it('/healthz, /readyz (kể cả có query) không log; biên 399/400/499/500', async () => {
    const lines: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _e, done) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        done();
      },
    });
    const a = express();
    a.use(...requestLogging(createLogger({ level: 'info', gitSha: 't', appEnv: 'test' }, sink)));
    a.get(['/healthz', '/readyz'], (_req, res) => {
      res.sendStatus(200);
    });
    a.get('/s/:code', (req, res) => {
      res.sendStatus(Number(req.params.code));
    });
    for (const path of ['/healthz', '/readyz?x=1', '/s/399', '/s/400', '/s/499', '/s/500']) {
      await request(a).get(path);
    }
    const logged = lines
      .filter((l) => l['req'])
      .map((l) => [(l['req'] as { path: string }).path, l['level']]);
    expect(logged).toEqual([
      ['/s/399', 'info'],
      ['/s/400', 'warn'],
      ['/s/499', 'warn'],
      ['/s/500', 'error'],
    ]);
  });
});

const rule = (r: Partial<RateLimitRule> = {}): RateLimitRule => ({
  id: 'r',
  windowMs: 60_000,
  limit: 1,
  key: 'ip',
  failMode: 'open',
  ...r,
});

describe('rate limit: khóa và Retry-After', () => {
  it('email băm SHA-256 của dạng chữ thường (khóa Valkey ổn định giữa các phiên bản)', () => {
    expect(hashEmail(' MIA@Example.com ')).toBe(
      createHash('sha256').update('mia@example.com').digest('hex'),
    );
  });

  it('Retry-After = số giây còn lại của cửa sổ (theo clock), không phải cả cửa sổ', async () => {
    const clock = new FakeClock('2026-11-01T00:00:00.000Z');
    const store = new MemoryStore();
    const a = express();
    a.set('trust proxy', 1);
    a.post(
      '/r',
      createRateLimit(rule({ windowMs: 120_000 }), {
        storeFor: () => store,
        logger: new SpyLogger(),
        userIdOf: () => undefined,
        now: () => clock.now().getTime(),
      }),
      (_req, res) => {
        res.sendStatus(200);
      },
    );
    a.use(
      globalErrorHandler({
        responder: new HttpResponder(clock),
        logger: new SpyLogger(),
        exposeInternalErrors: false,
      }),
    );
    await request(a).post('/r');
    const blocked = await request(a).post('/r');
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(120);
  });

  it('hit limiter: retryAfter theo resetTime của store; store không có resetTime ⇒ cả cửa sổ', async () => {
    const now = Date.parse('2026-11-01T00:00:00.000Z');
    const withReset: Store = {
      increment: () => Promise.resolve({ totalHits: 2, resetTime: new Date(now + 30_500) }),
      decrement: () => Promise.resolve(),
      resetKey: () => Promise.resolve(),
    };
    const limiter = createHitLimiter(rule({ windowMs: 60_000 }), {
      storeFor: () => withReset,
      logger: new SpyLogger(),
      now: () => now,
    });
    expect(await limiter.hit('k')).toEqual({ allowed: false, retryAfterSec: 31 });
    const noReset: Store = {
      increment: () => Promise.resolve({ totalHits: 1, resetTime: undefined }),
      decrement: () => Promise.resolve(),
      resetKey: () => Promise.resolve(),
    };
    const limiter2 = createHitLimiter(rule({ windowMs: 60_000 }), {
      storeFor: () => noReset,
      logger: new SpyLogger(),
      now: () => now,
    });
    expect(await limiter2.hit('k')).toEqual({ allowed: true, retryAfterSec: 60 });
  });
});

describe('FailModeStore', () => {
  const dead: Store = {
    increment: () => Promise.reject(new Error('down')),
    decrement: () => Promise.reject(new Error('down')),
    resetKey: () => Promise.resolve(),
    localKeys: true,
    prefix: 'p:',
  };

  it('chuyển tiếp localKeys/prefix của store bên trong', () => {
    const store = new FailModeStore(dead, rule(), new SpyLogger());
    expect([store.localKeys, store.prefix]).toEqual([true, 'p:']);
    const plain = new FailModeStore(new MemoryStore(), rule(), new SpyLogger());
    expect(plain.localKeys).toBe(true);
  });

  it('open: lượt giả có resetTime = now + cửa sổ; decrement lỗi chỉ cảnh báo; cảnh báo kèm rule + lỗi, chặn 30s', async () => {
    let now = 1_000_000;
    const logger = new SpyLogger();
    const store = new FailModeStore(dead, rule({ id: 'login' }), logger, () => now);
    await store.init({ windowMs: 60_000 } as never);
    expect(await store.increment('k')).toEqual({ totalHits: 1, resetTime: new Date(1_060_000) });
    await store.decrement('k');
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.data).toMatchObject({ rule: 'login' });
    expect((logger.entries[0]?.data['err'] as Error).message).toBe('down');
    now += 30_000;
    await store.increment('k');
    expect(logger.entries).toHaveLength(2);
  });

  it('closed: log error kèm rule + lỗi rồi ném 503', async () => {
    const logger = new SpyLogger();
    const store = new FailModeStore(dead, rule({ id: 'register', failMode: 'closed' }), logger);
    await expect(store.increment('k')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(logger.entries[0]?.data).toMatchObject({ rule: 'register' });
  });

  it('resetKey ủy quyền cho store bên trong', async () => {
    const keys: string[] = [];
    const inner: Store = { ...dead, resetKey: (k) => Promise.resolve(void keys.push(k)) };
    await new FailModeStore(inner, rule(), new SpyLogger()).resetKey('abc');
    expect(keys).toEqual(['abc']);
  });
});

describe('ResilientRedisStore (Redis giả)', () => {
  /** Redis giả: SCRIPT LOAD ⇒ sha, EVALSHA ⇒ [hits, ttl]; `down` ⇒ mọi lệnh lỗi. */
  function fakeRedis() {
    const state = { down: true, scriptLoads: 0, hits: 0 };
    const sendCommand = (...args: string[]) => {
      if (state.down) return Promise.reject(new Error('ECONNREFUSED'));
      if (args[0] === 'SCRIPT') {
        state.scriptLoads += 1;
        return Promise.resolve('sha1');
      }
      state.hits += 1;
      return Promise.resolve([state.hits, 60_000]);
    };
    return { state, store: new ResilientRedisStore({ sendCommand }) };
  }

  it('init khi Redis sập không ném, không treo; lần gọi đầu lỗi; Redis sống lại ⇒ lần kế tiếp nạp lại script và chạy', async () => {
    const { state, store } = fakeRedis();
    await expect(store.init({ windowMs: 60_000 } as never)).resolves.toBeUndefined();
    await expect(store.increment('k')).rejects.toThrow('ECONNREFUSED');
    state.down = false;
    expect((await store.increment('k')).totalHits).toBe(1);
    expect(state.scriptLoads).toBeGreaterThanOrEqual(2);
  });

  it('không nạp lại script khi không có lỗi (chỉ nạp ở init)', async () => {
    const { state, store } = fakeRedis();
    state.down = false;
    await store.init({ windowMs: 60_000 } as never);
    await store.increment('k');
    await store.increment('k');
    expect(state.scriptLoads).toBe(2); // increment + get script, đúng một lần
  });
});
