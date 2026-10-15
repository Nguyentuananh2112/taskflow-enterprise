import * as Sentry from '@sentry/nextjs';
import type { ErrorEvent } from '@sentry/nextjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readSentryConfig } from '@/app/config/server-env';

import { POST } from '../../../app/monitoring/route';
import { initClientSentry, readSentryMeta, SENTRY_META } from './sentry-client';
import { sanitizeWebEvent, scrubUrl } from './sentry-shared';
import { decideTunnel, ingestUrlOf, MAX_ENVELOPE_BYTES } from './sentry-tunnel';

const EMAIL = 'mia@example.com';
const DSN = 'https://public@o123.ingest.sentry.io/456';
const envelopeFor = (dsn: string) =>
  `${JSON.stringify({ dsn, sent_at: 'x' })}\n{"type":"event"}\n{}`;

describe('beforeSend web — allow-list (T-035 mục 2)', () => {
  it('bỏ user / breadcrumbs / extra / header-cookie-body; URL bỏ query; message lọc email/token', () => {
    const event = {
      type: undefined,
      message: `fail for ${EMAIL} token=${'a'.repeat(40)}`,
      user: { email: EMAIL, ip_address: '203.0.113.1' },
      breadcrumbs: [{ message: `typed ${EMAIL}` }],
      extra: { form: { email: EMAIL } },
      request: {
        url: `https://app.test/login?next=/board&email=${EMAIL}`,
        headers: { Cookie: 'tf_rt=secret', Authorization: 'Bearer x' },
        data: { password: 'hunter2' },
      },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: `bad ${EMAIL}`,
            stacktrace: {
              frames: [
                {
                  filename: `https://app.test/_next/x.js?q=${EMAIL}`,
                  lineno: 1,
                  vars: { password: 'hunter2' },
                },
              ],
            },
          },
        ],
      },
    } as unknown as ErrorEvent;
    const out = sanitizeWebEvent(event);
    const json = JSON.stringify(out);
    for (const secret of [EMAIL, 'hunter2', 'tf_rt', 'Bearer', '203.0.113.1', 'aaaaaaaaaa']) {
      expect(json).not.toContain(secret);
    }
    expect(out.request).toEqual({ url: 'https://app.test/login' });
    expect(out.exception?.values?.[0]).toMatchObject({
      type: 'TypeError',
      value: 'bad [REDACTED_EMAIL]',
    });
    expect(scrubUrl('/board?task=1#x')).toBe('/board');
  });
});

describe('tunnel /monitoring — không phải proxy mở', () => {
  it('decideTunnel: không DSN ⇒ 404; DSN khác ⇒ 403; header hỏng ⇒ 400; quá lớn ⇒ 413; khớp ⇒ URL ingest của chính DSN', () => {
    expect(decideTunnel(undefined, envelopeFor(DSN))).toEqual({ ok: false, status: 404 });
    expect(decideTunnel(DSN, envelopeFor('https://evil@attacker.test/1'))).toEqual({
      ok: false,
      status: 403,
    });
    expect(decideTunnel(DSN, 'not json\n{}')).toEqual({ ok: false, status: 400 });
    expect(decideTunnel(DSN, envelopeFor(DSN) + 'x'.repeat(MAX_ENVELOPE_BYTES))).toEqual({
      ok: false,
      status: 413,
    });
    expect(decideTunnel(DSN, envelopeFor(DSN))).toEqual({
      ok: true,
      url: 'https://o123.ingest.sentry.io/api/456/envelope/',
    });
    expect(ingestUrlOf('https://k@sentry.example.com/sub/789/')).toBe(
      'https://sentry.example.com/api/789/envelope/',
    );
  });

  describe('route POST', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    const post = (body: string) =>
      POST(new Request('http://web.test/monitoring', { method: 'POST', body }));

    it('không cấu hình SENTRY_DSN ⇒ 404, không gọi ra ngoài', async () => {
      vi.stubEnv('SENTRY_DSN', '');
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      expect((await post(envelopeFor(DSN))).status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('DSN khớp ⇒ chuyển tiếp nguyên envelope tới ingest; DSN lạ ⇒ 403 không gọi ra ngoài', async () => {
      vi.stubEnv('SENTRY_DSN', DSN);
      const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
      vi.stubGlobal('fetch', fetchSpy);
      expect((await post(envelopeFor('https://evil@attacker.test/1'))).status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await post(envelopeFor(DSN))).status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://o123.ingest.sentry.io/api/456/envelope/',
        expect.objectContaining({ method: 'POST', body: envelopeFor(DSN) }),
      );
    });
  });
});

describe('cấu hình Sentry web', () => {
  it('readSentryConfig: DSN trống ⇒ tắt; release = GIT_SHA; environment = APP_ENV', () => {
    expect(readSentryConfig({ API_URL: 'http://a.test', SENTRY_DSN: '' })).toEqual({
      environment: 'production',
    });
    expect(readSentryConfig({ SENTRY_DSN: DSN, GIT_SHA: 'abc', APP_ENV: 'staging' })).toEqual({
      dsn: DSN,
      environment: 'staging',
      release: 'abc',
    });
  });

  it('readSentryMeta: đọc <meta> của root layout; không DSN ⇒ null (Sentry tắt)', () => {
    document.head.innerHTML = '';
    expect(readSentryMeta(document)).toBeNull();
    document.head.innerHTML = `<meta name="${SENTRY_META.dsn}" content="${DSN}"><meta name="${SENTRY_META.environment}" content="staging"><meta name="${SENTRY_META.release}" content="abc">`;
    expect(readSentryMeta(document)).toEqual({ dsn: DSN, environment: 'staging', release: 'abc' });
    document.head.innerHTML = '';
  });

  it('SDK trình duyệt thật: envelope gửi đi không chứa email / query của URL trang', async () => {
    document.head.innerHTML = `<meta name="${SENTRY_META.dsn}" content="${DSN}">`;
    window.history.pushState({}, '', `/board?task=1&email=${EMAIL}`);
    const envelopes: string[] = [];
    const decoder = new TextDecoder();
    const transport: NonNullable<Parameters<typeof initClientSentry>[1]> = (
      options: Parameters<typeof Sentry.createTransport>[0],
    ) =>
      Sentry.createTransport(options, (request) => {
        envelopes.push(
          typeof request.body === 'string' ? request.body : decoder.decode(request.body),
        );
        return Promise.resolve({ statusCode: 200 });
      });
    initClientSentry(document, transport);
    Sentry.captureException(new Error(`save failed for ${EMAIL}`));
    await Sentry.flush(2_000);
    const all = envelopes.join('\n');
    expect(all).toContain('{"type":"event"}');
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain('task=1');
    await Sentry.close(1_000);
    document.head.innerHTML = '';
  });
});
