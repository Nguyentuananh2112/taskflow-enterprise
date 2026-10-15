// T-035 mục 1: lỗi DB THẬT (P2039 — dòng có email + hash argon2id) đi qua SDK Sentry thật ⇒ envelope
// gửi đi KHÔNG chứa email/hash. Transport bắt envelope thay vì gửi mạng.
import * as Sentry from '@sentry/node';
import { afterAll, describe, expect, it } from 'vitest';

import { createSentryReporter } from '../../../src/core/observability/sentry';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { SpyLogger } from '../../support';
import { leakedSecrets, LEAK_EMAIL, LEAK_HASH } from '../../support/prisma-errors';
import { createTestPrisma, truncateAll } from '../db';

const prisma: PrismaClient = createTestPrisma();
const envelopes: string[] = [];
const decoder = new TextDecoder();
const reporter = createSentryReporter({
  dsn: 'https://public@o0.ingest.sentry.io/0',
  environment: 'test',
  release: 'sha-int',
  tracesSampleRate: 0,
  logger: new SpyLogger(),
  transport: (options) =>
    Sentry.createTransport(options, (request) => {
      envelopes.push(
        typeof request.body === 'string' ? request.body : decoder.decode(request.body),
      );
      return Promise.resolve({ statusCode: 200 });
    }),
});

afterAll(async () => {
  await reporter.close(2_000);
  await prisma.$disconnect();
});

describe('Sentry: lỗi DB thật không rò PII (T-035)', () => {
  it('P2039 từ Postgres: lỗi gốc CÓ email/hash, envelope gửi Sentry thì không', async () => {
    await truncateAll(prisma);
    const raw = await prisma.user
      .create({ data: { email: LEAK_EMAIL, fullName: 'Leak', passwordHash: LEAK_HASH } })
      .then(
        () => undefined,
        (err: unknown) => err,
      );
    expect(raw).toBeDefined();
    expect(JSON.stringify(raw)).toContain(LEAK_EMAIL); // tiền đề: lỗi thật mang dữ liệu dòng

    envelopes.length = 0;
    reporter.capture(raw);
    await Sentry.flush(2_000);
    const event = envelopes.find((e) => e.includes('{"type":"event"}'));
    expect(event).toBeDefined();
    expect(event).toContain('P2039');
    expect(leakedSecrets(envelopes)).toEqual([]);
  });
});
