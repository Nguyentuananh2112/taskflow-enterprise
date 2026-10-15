import * as Sentry from '@sentry/nextjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { onRequestError } from '../../../instrumentation';
import { initServerSentry } from './sentry-server';

// Chạy bằng SDK SERVER thật của @sentry/nextjs (project vitest.server.config.ts, môi trường node, không
// alias sang bản client) — đóng khoảng trống "xanh giả" của phía server (T-035, TL + review E).

const EMAIL = 'mia@example.com';
const DSN = 'https://public@o123.ingest.sentry.io/456';
const envelopes: string[] = [];
const decoder = new TextDecoder();

beforeAll(() => {
  vi.stubEnv('SENTRY_DSN', DSN);
  vi.stubEnv('APP_ENV', 'staging');
  vi.stubEnv('GIT_SHA', 'sha-web');
  const started = initServerSentry((options: Parameters<typeof Sentry.createTransport>[0]) =>
    Sentry.createTransport(options, (request) => {
      envelopes.push(
        typeof request.body === 'string' ? request.body : decoder.decode(request.body),
      );
      return Promise.resolve({ statusCode: 200 });
    }),
  );
  expect(started).toBe(true);
});

afterAll(async () => {
  await Sentry.close(1_000);
  vi.unstubAllEnvs();
});

describe('Sentry web — SDK SERVER thật (route handler / server component)', () => {
  it('đúng là bản server, không lan truyền trace (tracePropagationTargets [])', () => {
    const options = Sentry.getClient()?.getOptions();
    const integrations = options?.integrations.map((i) => i.name) ?? [];
    expect(integrations).toContain('Http'); // integration của Node — không phải bản trình duyệt
    expect(integrations).not.toContain('BrowserTracing');
    expect(options?.tracePropagationTargets).toEqual([]);
  });

  it('onRequestError: lỗi có email + Cookie + query ⇒ envelope không chứa chúng; có release/environment', async () => {
    envelopes.length = 0;
    onRequestError(
      new Error(`render failed for ${EMAIL} token=${'a'.repeat(40)}`),
      {
        path: `/board?task=1&email=${EMAIL}`,
        method: 'GET',
        headers: {
          cookie: '__Host-tf_rt=secret-refresh',
          authorization: 'Bearer secret-access',
          'x-forwarded-for': '203.0.113.9',
        },
      },
      {
        routerKind: 'App Router',
        routePath: '/board',
        routeType: 'render',
      },
    );
    await Sentry.flush(2_000);
    const all = envelopes.join('\n');
    expect(all).toContain('{"type":"event"}');
    expect(all).toContain('"release":"sha-web"');
    expect(all).toContain('"environment":"staging"');
    for (const secret of [
      EMAIL,
      'secret-refresh',
      'secret-access',
      '203.0.113.9',
      'task=1',
      'aaaaaaaaaa',
    ]) {
      expect(all).not.toContain(secret);
    }
  });
});
