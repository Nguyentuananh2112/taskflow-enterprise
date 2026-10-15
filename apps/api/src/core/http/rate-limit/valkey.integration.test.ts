// Tầng I: Valkey thật (ADR-063, cổng local 6380 — ADR-097). Biến TEST_VALKEY_URL để đổi;
// REQUIRE_INTEGRATION=1 (CI) ⇒ thiếu Valkey là FAIL, không âm thầm bỏ qua.
import { randomUUID } from 'node:crypto';

import express from 'express';
import { createClient } from 'redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorOf, FakeClock, SpyLogger } from '../../../../test/support';
import { createValkeyClient } from '../../infrastructure/valkey';
import { HttpResponder } from '../envelope';
import { globalErrorHandler } from '../error-handler';
import { createRateLimits, type RateLimitDeps } from './rate-limit';
import type { RateLimitRule } from './rules';
import { createValkeyStore, type CommandSender } from './store';

const URL = process.env['TEST_VALKEY_URL'] ?? 'redis://127.0.0.1:6380';
const RUN = randomUUID().slice(0, 8); // khóa riêng mỗi lần chạy — không đụng dữ liệu khác trên Valkey dùng chung

const probe = createClient({
  url: URL,
  socket: { connectTimeout: 1_000, reconnectStrategy: false },
});
probe.on('error', () => undefined);
const available = await probe.connect().then(
  () => true,
  () => false,
);
if (!available && process.env['REQUIRE_INTEGRATION'] === '1')
  throw new Error(`Valkey không chạy ở ${URL}`);

function app(rules: readonly RateLimitRule[], deps: RateLimitDeps, status = 200) {
  const a = express();
  a.use(express.json());
  a.post('/login', ...createRateLimits(rules, deps), (_req, res) => {
    res.status(status).json({});
  });
  a.use(
    globalErrorHandler({
      responder: new HttpResponder(new FakeClock()),
      logger: new SpyLogger(),
      exposeInternalErrors: false,
    }),
  );
  return a;
}

const loginRule = (id: string, limit = 2): RateLimitRule => ({
  id: `${RUN}-${id}`,
  windowMs: 60_000,
  limit,
  key: 'ip+email',
  failMode: 'closed',
  countFailedOnly: true,
});

describe.runIf(available)('rate limit trên Valkey thật (tầng I)', () => {
  const valkey = createValkeyClient(URL, new SpyLogger());
  beforeAll(() => valkey.connect().then(() => undefined));
  afterAll(async () => {
    const keys = await valkey.keys(`rl:${RUN}-*`);
    if (keys.length) await valkey.del(keys);
    await valkey.close();
    await probe.close();
  });

  it('đếm lần đăng nhập sai qua Valkey, khóa `rl:{rule}:{key}` có TTL', async () => {
    const rule = loginRule('count');
    const deps = {
      storeFor: (r: RateLimitRule) => createValkeyStore(valkey, r),
      logger: new SpyLogger(),
      userIdOf: () => undefined,
    };
    const a = app([rule], deps, 401);
    expect((await request(a).post('/login').send({ email: 'mia@example.com' })).status).toBe(401);
    expect((await request(a).post('/login').send({ email: 'mia@example.com' })).status).toBe(401);
    expect((await request(a).post('/login').send({ email: 'mia@example.com' })).status).toBe(429);

    const keys = await valkey.keys(`rl:${rule.id}:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('mia@example.com'); // email đã băm
    expect(await valkey.pTTL(keys[0] ?? '')).toBeGreaterThan(0);
  });

  it('login fail-closed khi Valkey chết: 503, không chạy handler', async () => {
    const dead = createValkeyClient('redis://127.0.0.1:1', new SpyLogger());
    const deps = {
      storeFor: (r: RateLimitRule) => createValkeyStore(dead, r),
      logger: new SpyLogger(),
      userIdOf: () => undefined,
    };
    const res = await request(app([loginRule('dead')], deps))
      .post('/login')
      .send({ email: 'mia@example.com' });
    expect(res.status).toBe(503);
    expect(errorOf(res).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('Valkey sập lúc khởi động rồi hồi phục ⇒ limiter tự hoạt động lại (ResilientRedisStore)', async () => {
    let down = true;
    const flaky: CommandSender = {
      sendCommand: (args) =>
        down ? Promise.reject(new Error('ECONNREFUSED')) : valkey.sendCommand(args),
    };
    const deps = {
      storeFor: (r: RateLimitRule) => createValkeyStore(flaky, r),
      logger: new SpyLogger(),
      userIdOf: () => undefined,
    };
    const a = app([loginRule('recover', 1)], deps, 401);
    expect((await request(a).post('/login').send({ email: 'x@example.com' })).status).toBe(503);
    down = false;
    expect((await request(a).post('/login').send({ email: 'x@example.com' })).status).toBe(401);
    expect((await request(a).post('/login').send({ email: 'x@example.com' })).status).toBe(429);
  });
});
