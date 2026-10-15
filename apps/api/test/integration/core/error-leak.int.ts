// T-031 mục 0 (audit T-028, HIGH): lỗi DB THẬT mang dữ liệu dòng (email + hash argon2id) không được
// lọt vào log hay `details.debug`. Lỗi được sinh trên Postgres thật — không dựng tay.
import { Writable } from 'node:stream';

import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { createLogger } from '../../../src/core/logging/pino-logger';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { FakeClock } from '../../support';
import { leakedSecrets, LEAK_EMAIL, LEAK_HASH } from '../../support/prisma-errors';
import { createTestPrisma, truncateAll } from '../db';

const prisma: PrismaClient = createTestPrisma();
beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

/** Vi phạm `users_email_lowercase_chk` ⇒ P2039, `cause.detail` = "Failing row contains (…)". */
const checkViolation = () =>
  prisma.user.create({ data: { email: LEAK_EMAIL, fullName: 'Leak', passwordHash: LEAK_HASH } });
/** Sai kiểu tham số ⇒ PrismaClientValidationError, message in cả `data` kèm giá trị. */
const validationError = () =>
  prisma.user.create({
    data: {
      email: LEAK_EMAIL.toLowerCase(),
      fullName: 'Leak',
      passwordHash: LEAK_HASH,
      tokenVersion: 'nope' as unknown as number,
    },
  });

async function capturedFailure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('lệnh Prisma đáng lẽ phải lỗi');
}

describe('lỗi DB thật không rò email / hash mật khẩu (T-031 mục 0)', () => {
  it.each([
    ['vi phạm CHECK (P2039)', checkViolation, 'PrismaClientKnownRequestError'],
    ['PrismaClientValidationError', validationError, 'PrismaClientValidationError'],
  ] as const)('%s: lỗi gốc CÓ dữ liệu, log + response thì không', async (_label, run, name) => {
    // Tiền đề: lỗi thật đúng là mang dữ liệu nhạy cảm (nếu Prisma đổi, test này báo để xem lại).
    const raw = await capturedFailure(run);
    const rawText = JSON.stringify(raw) + String((raw as Error).message);
    expect(rawText.includes(LEAK_EMAIL) || rawText.includes('$argon2id$')).toBe(true);

    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const router = Router();
    router.post('/leak', async () => {
      await run();
    });
    const app = createApp({
      config: {
        gitSha: 'sha-1',
        corsOrigins: [],
        trustProxyHops: 0,
        production: false, // details.debug bật — kiểm cả đường trả cho client
        hsts: false,
        bodyLimit: '1kb',
      },
      logger: createLogger({ level: 'info', gitSha: 'sha-1', appEnv: 'local' }, stream),
      clock: new FakeClock('2026-10-15T08:00:00.000Z'),
      probes: [],
      isShuttingDown: () => false,
      apiRouter: router,
    });

    const res = await request(app).post('/api/v1/leak').set('Content-Type', 'application/json');
    expect(res.status).toBe(500);
    const body = res.body as { error: { details: { debug: { name: string } } } };
    expect(body.error.details.debug.name).toBe(name);
    expect(lines.some((l) => l.includes('http.unhandled_error'))).toBe(true);
    expect(leakedSecrets(lines.join(''))).toEqual([]);
    expect(leakedSecrets(res.body)).toEqual([]);
  });
});
