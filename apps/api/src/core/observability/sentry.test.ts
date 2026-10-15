import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SpyLogger } from '../../../test/support';
import {
  leakedSecrets,
  LEAK_EMAIL,
  LEAK_HASH,
  prismaCheckViolation,
  prismaValidationError,
} from '../../../test/support/prisma-errors';
import { requestContext } from '../context/request-context';
import { createSentryReporter, sanitizeTransactionEvent, type IErrorReporter } from './sentry';

/** Envelope Sentry THẬT (sau beforeSend + serialize của SDK) — đúng thứ sẽ gửi qua mạng. */
const envelopes: string[] = [];
const decoder = new TextDecoder();
let reporter: IErrorReporter;

beforeAll(() => {
  reporter = createSentryReporter({
    dsn: 'https://public@o0.ingest.sentry.io/0',
    environment: 'test',
    release: 'sha-test',
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
});
afterAll(() => reporter.close(2_000));

/** Chạy `run`, đợi gửi xong; trả envelope LỖI (envelope "session" của release health đi kèm). */
async function sent(run: () => void): Promise<string> {
  envelopes.length = 0;
  run();
  await Sentry.flush(2_000);
  // Mọi envelope (kể cả session) đều không được mang dữ liệu nhạy cảm.
  expect(leakedSecrets(envelopes)).toEqual([]);
  const events = envelopes.filter((e) => e.includes('{"type":"event"}'));
  expect(events).toHaveLength(1);
  return events[0] ?? '';
}

describe('Sentry API — beforeSend allow-list (T-035 mục 1)', () => {
  it('lỗi P2039 (dữ liệu dòng: email + hash) ⇒ envelope KHÔNG chứa email/hash; có code, reqId, release, environment', async () => {
    const envelope = await sent(() =>
      requestContext.run({ requestId: 'req-p2039', ip: '203.0.113.9' }, () =>
        reporter.capture(prismaCheckViolation()),
      ),
    );
    expect(leakedSecrets(envelope)).toEqual([]);
    expect(envelope).toContain('P2039');
    expect(envelope).toContain('users_email_lowercase_chk');
    expect(envelope).toContain('"reqId":"req-p2039"');
    expect(envelope).toContain('"release":"sha-test"');
    expect(envelope).toContain('"environment":"test"');
    expect(envelope).not.toContain('203.0.113.9'); // IP không gửi Sentry
  });

  it('PrismaClientValidationError (message in cả tham số) ⇒ chỉ tên lỗi', async () => {
    const envelope = await sent(() => reporter.capture(prismaValidationError()));
    expect(leakedSecrets(envelope)).toEqual([]);
    expect(envelope).toContain('PrismaClientValidationError');
  });

  it('lỗi thường: message qua bộ lọc mẫu; không biến cục bộ / dòng mã nguồn / breadcrumb', async () => {
    const envelope = await sent(() => {
      const secretToken = `token=${'x'.repeat(40)}`;
      Sentry.addBreadcrumb({ message: `login ${LEAK_EMAIL}` });
      reporter.capture(new Error(`boom ${LEAK_EMAIL} ${LEAK_HASH} ${secretToken}`));
    });
    expect(leakedSecrets(envelope)).toEqual([]);
    expect(envelope).toContain('[REDACTED_EMAIL]');
    expect(envelope).not.toContain('xxxxxxxxxx');
    expect(envelope).not.toMatch(/"vars"|"context_line"|"pre_context"|"breadcrumbs"/);
  });
});

describe('beforeSendTransaction allow-list', () => {
  it('tên giao dịch / span bỏ query; data span chỉ giữ khóa an toàn', () => {
    const out = sanitizeTransactionEvent({
      type: 'transaction',
      transaction: `GET /api/v1/workspaces/w/members?q=${LEAK_EMAIL}`,
      start_timestamp: 1,
      timestamp: 2,
      request: { url: `https://api.test/x?q=${LEAK_EMAIL}`, headers: { cookie: 'tf_rt=secret' } },
      user: { email: LEAK_EMAIL },
      contexts: {
        trace: {
          trace_id: 't',
          span_id: 's',
          data: { 'http.route': '/workspaces/:wsId/members', 'http.url': `/x?q=${LEAK_EMAIL}` },
        },
      },
      spans: [
        {
          span_id: 'a',
          trace_id: 't',
          start_timestamp: 1,
          status: 'ok',
          description: `GET /x?q=${LEAK_EMAIL}`,
          data: {
            'http.response.status_code': 200,
            'db.statement': `SELECT * FROM users WHERE email = '${LEAK_EMAIL}'`,
            'url.query': `q=${LEAK_EMAIL}`,
          },
        },
      ],
    });
    expect(leakedSecrets(out)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('tf_rt');
    expect(out.transaction).toBe('GET /api/v1/workspaces/w/members');
    expect(out.spans?.[0]?.data).toEqual({ 'http.response.status_code': 200 });
    expect(out.contexts?.trace?.data).toEqual({ 'http.route': '/workspaces/:wsId/members' });
  });
});
