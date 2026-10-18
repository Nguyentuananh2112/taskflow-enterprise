// App HTTP đầy đủ (composition root thật) trên Postgres test — cho test hồi quy chạm đúng wiring production
// (`createPrismaPersistence`). Valkey thay bằng Map (session store chỉ cần mGet / set); hasher giả như test HTTP.
import { Writable } from 'node:stream';

import { MemoryStore } from 'express-rate-limit';
import request from 'supertest';

import { createContainer } from '../../../src/composition/container';
import { createPrismaPersistence } from '../../../src/composition/prisma-persistence';
import { CryptoRandom } from '../../../src/core/infrastructure/system';
import { createLogger } from '../../../src/core/logging/pino-logger';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { PasswordPolicy } from '../../../src/modules/auth/domain/password-policy';
import { FakePasswordHasher } from '../../../src/modules/auth/testing/fakes';
import { envelopeOf } from '../../support/http';
import { FakeClock, SequentialIdGenerator } from '../../support/time-and-ids';

export const PRISMA_APP_PASSWORD = 'correct-horse-12';
/** Hash mà `FakePasswordHasher` chấp nhận cho `PRISMA_APP_PASSWORD` — đặt vào `passwordHash` khi seed. */
export const PRISMA_APP_PASSWORD_HASH = `h:${PRISMA_APP_PASSWORD}`;

export function createPrismaTestApp(prisma: PrismaClient, now: Date) {
  const logs: string[] = [];
  const logger = createLogger(
    { level: 'info', gitSha: 'test', appEnv: 'test' },
    new Writable({
      write(chunk: Buffer, _enc, done) {
        logs.push(chunk.toString());
        done();
      },
    }),
  );
  const kv = new Map<string, string>();
  const valkey = {
    mGet: (keys: string[]) => Promise.resolve(keys.map((k) => kv.get(k) ?? null)),
    set: (key: string, value: string) => Promise.resolve(kv.set(key, value)),
  };
  const stores = new Map<string, MemoryStore>();
  const clock = new FakeClock(now.toISOString());
  const { app } = createContainer({
    config: {
      gitSha: 'test',
      corsOrigins: ['http://localhost:3001'],
      trustProxyHops: 1,
      production: false,
      hsts: false,
      bodyLimit: '100kb',
      cookieSecure: false,
      jwtSecret: 'test-only-jwt-secret-0123456789abcdef',
    },
    logger,
    clock,
    ids: new SequentialIdGenerator(),
    random: new CryptoRandom(),
    hasher: new FakePasswordHasher(),
    policy: new PasswordPolicy(new Set()),
    persistence: createPrismaPersistence({ prisma, valkey, logger }),
    rateLimitStore: (rule) => {
      const store = stores.get(rule.id) ?? new MemoryStore();
      stores.set(rule.id, store);
      return store;
    },
    probes: [],
    isShuttingDown: () => false,
  });

  /** Đăng nhập thật ⇒ header cho request sau. */
  async function login(email: string) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.7')
      .send({ email, password: PRISMA_APP_PASSWORD });
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${res.text}`);
    const token = envelopeOf<{ accessToken: string }>(res).data?.accessToken ?? '';
    return { Authorization: `Bearer ${token}`, 'X-Forwarded-For': '198.51.100.7' };
  }
  return { app, logs, login };
}
