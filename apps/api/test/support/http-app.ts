import { applyVietnameseZodLocale } from '@taskflow/contracts';
import { MemoryStore } from 'express-rate-limit';
import request, { type Response } from 'supertest';

import { createContainer, type ContainerConfig } from '../../src/composition/container';
import { createMemoryPersistence } from '../../src/composition/persistence';
import { CryptoRandom } from '../../src/core/infrastructure/system';
import { createLogger } from '../../src/core/logging/pino-logger';
import type { DestinationStream } from 'pino';
import { PasswordPolicy } from '../../src/modules/auth/domain/password-policy';
import { FakePasswordHasher } from '../../src/modules/auth/testing/fakes';
import { envelopeOf } from './http';
import { FakeClock, SequentialIdGenerator } from './time-and-ids';

export const WEB = 'http://localhost:3001';
export const PASSWORD = 'correct-horse-12';
export const NOW = '2026-11-01T00:00:00.000Z';

/**
 * App HTTP đầy đủ (composition root thật) trên lưu trữ InMemory — dùng cho test tầng route.
 * Hasher giả cho nhanh (argon2 thật có test riêng ở T-013); JWT, cookie, rate limit, policy thật.
 */
export function createTestApp(
  overrides: Partial<ContainerConfig> = {},
  /** Ghi log ra stream này (mức info) thay vì im lặng — test kiểm nội dung log (T-032). */
  options: { logDestination?: DestinationStream } = {},
) {
  applyVietnameseZodLocale();
  const clock = new FakeClock(NOW);
  const logger = createLogger(
    { level: options.logDestination ? 'info' : 'silent', gitSha: 'test', appEnv: 'test' },
    options.logDestination,
  );
  const persistence = createMemoryPersistence(logger);
  const stores = new Map<string, MemoryStore>();
  const container = createContainer({
    config: {
      gitSha: 'test',
      corsOrigins: [WEB],
      trustProxyHops: 1,
      production: false,
      hsts: false,
      bodyLimit: '100kb',
      cookieSecure: false,
      jwtSecret: 'test-only-jwt-secret-0123456789abcdef',
      ...overrides,
    },
    logger,
    clock,
    ids: new SequentialIdGenerator(),
    random: new CryptoRandom(),
    hasher: new FakePasswordHasher(),
    policy: new PasswordPolicy(new Set(['password123456'])),
    persistence,
    rateLimitStore: (rule) => {
      const store = stores.get(rule.id) ?? new MemoryStore();
      stores.set(rule.id, store);
      return store;
    },
    probes: [],
    isShuttingDown: () => false,
  });
  const app = container.app;

  /** Mỗi người dùng test đi từ một IP riêng ⇒ không chạm rate limit theo IP của nhau. */
  let ipSeq = 0;
  const nextIp = () => `198.51.100.${++ipSeq}`;

  async function register(fullName: string, email = `${fullName.toLowerCase()}@example.com`) {
    const ip = nextIp();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password: PASSWORD, fullName });
    if (res.status !== 201)
      throw new Error(`register ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    const data = envelopeOf<{
      accessToken: string;
      user: { id: string; email: string };
      defaultWorkspaceId: string;
    }>(res).data;
    if (!data) throw new Error('register: thiếu data');
    return {
      ip,
      email,
      id: data.user.id,
      token: data.accessToken,
      workspaceId: data.defaultWorkspaceId,
      cookie: refreshCookieOf(res),
      auth: { Authorization: `Bearer ${data.accessToken}`, 'X-Forwarded-For': ip },
    };
  }

  return { app, container, persistence, clock, register, nextIp };
}

export type TestApp = ReturnType<typeof createTestApp>;
export type TestUser = Awaited<ReturnType<TestApp['register']>>;

/** Giá trị `Set-Cookie` của refresh token (chuỗi đầy đủ để kiểm thuộc tính). */
export function setCookieOf(res: Response, name = 'tf_rt'): string | undefined {
  const raw = res.headers['set-cookie'] as unknown;
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return list.find((c) => c.startsWith(`${name}=`));
}

/** Cặp `tf_rt=<token>` để gửi lại trong header Cookie. */
export function refreshCookieOf(res: Response, name = 'tf_rt'): string {
  const cookie = setCookieOf(res, name);
  if (!cookie) throw new Error('response không đặt cookie refresh');
  return cookie.split(';')[0] ?? '';
}
