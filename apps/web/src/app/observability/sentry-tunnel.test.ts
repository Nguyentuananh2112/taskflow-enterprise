import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../../../app/monitoring/route';
import { readSentryConfig } from '@/app/config/server-env';
import { sanitizeWebTransaction } from './sentry-shared';
import {
  clientIpOf,
  decideTunnel,
  ipv6Prefix56,
  MAX_ENVELOPE_BYTES,
  readCapped,
  TUNNEL_LIMITS,
  TunnelRateLimiter,
} from './sentry-tunnel';

const DSN = 'https://public@o123.ingest.sentry.io/456';
const EMAIL = 'mia@example.com';

/** Luồng "chunked" vô hạn: đếm số chunk đã bị đọc (chứng minh không đệm toàn bộ). */
function endlessStream(chunkBytes: number) {
  let pulled = 0;
  const chunk = new Uint8Array(chunkBytes).fill(120);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(chunk);
    },
  });
  return { stream, pulled: () => pulled };
}

describe('M1 (review B): tunnel đọc body dạng luồng có trần', () => {
  it('readCapped: luồng vô hạn ⇒ null ngay sau khi vượt trần, chỉ đọc ~trần byte (không đệm hết)', async () => {
    const { stream, pulled } = endlessStream(16_384);
    expect(await readCapped(stream, MAX_ENVELOPE_BYTES)).toBeNull();
    expect(pulled() * 16_384).toBeLessThanOrEqual(MAX_ENVELOPE_BYTES + 2 * 16_384);
  });

  it('readCapped: dưới trần ⇒ chuỗi đầy đủ; body null ⇒ rỗng', async () => {
    const body = new Response('xin chào').body;
    expect(await readCapped(body, 100)).toBe('xin chào');
    expect(await readCapped(null, 100)).toBe('');
  });

  describe('route', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('request chunked (KHÔNG Content-Length) > 200 kB ⇒ 413, không gọi Sentry, không đọc hết luồng', async () => {
      vi.stubEnv('SENTRY_DSN', DSN);
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const { stream, pulled } = endlessStream(16_384);
      const request = new Request('http://web.test/monitoring', {
        method: 'POST',
        body: stream,
        headers: { 'X-Forwarded-For': '203.0.113.50' },
        duplex: 'half',
      } as RequestInit);
      expect(request.headers.get('content-length')).toBeNull();
      expect((await POST(request)).status).toBe(413);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(pulled() * 16_384).toBeLessThanOrEqual(MAX_ENVELOPE_BYTES + 2 * 16_384);
    });

    it('L1: quá 30 request/phút từ một IP ⇒ 429 (Retry-After)', async () => {
      vi.stubEnv('SENTRY_DSN', DSN);
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
      );
      const send = () =>
        POST(
          new Request('http://web.test/monitoring', {
            method: 'POST',
            body: `${JSON.stringify({ dsn: DSN })}\n{"type":"event"}\n{}`,
            headers: { 'X-Forwarded-For': '203.0.113.77' },
          }),
        );
      for (let i = 0; i < TUNNEL_LIMITS.perIp; i++) expect((await send()).status).toBe(200);
      const limited = await send();
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('60');
    });
  });
});

describe('L1 (review B): chỉ chuyển tiếp item lỗi; hạn mức theo IP + tổng instance', () => {
  const env = (...types: string[]) =>
    [
      JSON.stringify({ dsn: DSN }),
      ...types.flatMap((t) => [JSON.stringify({ type: t }), '{}']),
    ].join('\n');

  it('envelope chỉ có event ⇒ chuyển tiếp; có session/replay/attachment ⇒ 200 KHÔNG chuyển tiếp; không item ⇒ 400', () => {
    expect(decideTunnel(DSN, env('event')).ok).toBe(true);
    for (const t of ['session', 'replay_event', 'attachment', 'client_report']) {
      expect(decideTunnel(DSN, env('event', t))).toEqual({ ok: false, status: 200 });
    }
    expect(decideTunnel(DSN, JSON.stringify({ dsn: DSN }))).toEqual({ ok: false, status: 400 });
    expect(decideTunnel(DSN, `${JSON.stringify({ dsn: DSN })}\nnot-json\n{}`)).toEqual({
      ok: false,
      status: 400,
    });
  });

  it('TunnelRateLimiter: theo IP và trần tổng; qua cửa sổ thì được lại', () => {
    const limiter = new TunnelRateLimiter({ windowMs: 1_000, perIp: 2, perInstance: 3 });
    expect([limiter.tryHit('a', 0), limiter.tryHit('a', 1), limiter.tryHit('a', 2)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(limiter.tryHit('b', 3)).toBe(true);
    expect(limiter.tryHit('c', 4)).toBe(false); // trần tổng 3
    expect(limiter.tryHit('a', 1_002)).toBe(true);
  });

  it('clientIpOf: phần tử thứ TRUST_PROXY_HOPS tính từ cuối X-Forwarded-For (cùng quy tắc API)', () => {
    const xff = new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 198.51.100.1' });
    expect(clientIpOf(xff, 1)).toBe('198.51.100.1'); // 1 proxy (LB)
    expect(clientIpOf(xff, 2)).toBe('203.0.113.9'); // CDN + LB ⇒ áp chót
    expect(clientIpOf(xff, 0)).toBe('unknown'); // không tin XFF ⇒ chỉ còn trần tổng
    expect(clientIpOf(xff, 9)).toBe('unknown'); // chuỗi ngắn hơn số hops
    expect(clientIpOf(new Headers())).toBe('unknown');
  });

  it('IPv6 gom theo /56 (như ipKeyGenerator của API) — xoay địa chỉ trong một dải không né được hạn mức', () => {
    expect(ipv6Prefix56('2001:db8:aa:bbcc::1')).toBe('2001:0db8:00aa:bb00::/56');
    expect(ipv6Prefix56('2001:db8:aa:bbff:1:2:3:4')).toBe('2001:0db8:00aa:bb00::/56');
    expect(ipv6Prefix56('203.0.113.9')).toBe('203.0.113.9');
    expect(ipv6Prefix56('::ffff:203.0.113.9')).toBe('::ffff:203.0.113.9');
    const xff = new Headers({ 'x-forwarded-for': '2001:db8:aa:bb01::9' });
    expect(clientIpOf(xff)).toBe('2001:0db8:00aa:bb00::/56');
  });

  it('Map của limiter bị chặn: bơm 25 000 IP khác nhau (kể cả lúc trần tổng bão hòa) ⇒ không vượt trần số khóa', () => {
    const limiter = new TunnelRateLimiter({ windowMs: 60_000, perIp: 30, perInstance: 1_000_000 });
    for (let i = 0; i < 25_000; i++) limiter.tryHit(`ip-${i}`, i);
    expect(limiter.trackedIps).toBeLessThanOrEqual(TunnelRateLimiter.MAX_TRACKED_IPS);
    const saturated = new TunnelRateLimiter({ windowMs: 60_000, perIp: 30, perInstance: 1 });
    saturated.tryHit('first', 0);
    for (let i = 0; i < 25_000; i++) expect(saturated.tryHit(`rot-${i}`, i)).toBe(false);
    expect(saturated.trackedIps).toBe(1); // IP bị từ chối KHÔNG được thêm vào Map
  });
});

describe('L2 (review B): giao dịch web theo allow-list', () => {
  it('bỏ request/user/extra/tags/breadcrumbs; span chỉ giữ data an toàn; tên không query', () => {
    const out = sanitizeWebTransaction({
      type: 'transaction',
      transaction: `/board?task=1&email=${EMAIL}`,
      start_timestamp: 1,
      timestamp: 2,
      request: { url: `https://app.test/?q=${EMAIL}`, headers: { cookie: 'tf_rt=secret' } },
      user: { email: EMAIL },
      extra: { form: { email: EMAIL } },
      tags: { email: EMAIL },
      breadcrumbs: [{ message: EMAIL }],
      contexts: {
        trace: {
          trace_id: 't',
          span_id: 's',
          data: { 'http.url': `/x?q=${EMAIL}`, 'http.route': '/board' },
        },
        user: { email: EMAIL },
      },
      spans: [
        {
          span_id: 'a',
          trace_id: 't',
          start_timestamp: 1,
          status: 'ok',
          description: `fetch /api?q=${EMAIL}`,
          data: { 'http.response.status_code': 200, 'url.query': `q=${EMAIL}` },
        },
      ],
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain(EMAIL);
    expect(json).not.toContain('tf_rt');
    expect(out.transaction).toBe('/board');
    expect(out.contexts).toEqual({
      trace: { trace_id: 't', span_id: 's', data: { 'http.route': '/board' } },
    });
    expect(out.spans?.[0]?.data).toEqual({ 'http.response.status_code': 200 });
  });
});

describe('L3 (review B): DSN http ở staging/production ⇒ Sentry tắt (không ném — không làm sập trang)', () => {
  it.each(['staging', 'production'])('%s', (appEnv) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      readSentryConfig({ SENTRY_DSN: 'http://public@sentry.test/1', APP_ENV: appEnv }),
    ).toEqual({ environment: appEnv, trustProxyHops: 1 });
    warn.mockRestore();
  });

  it('local/test vẫn nhận DSN http (Sentry tự host trong máy dev)', () => {
    expect(
      readSentryConfig({ SENTRY_DSN: 'http://public@sentry.test/1', APP_ENV: 'local' }),
    ).toEqual({
      dsn: 'http://public@sentry.test/1',
      environment: 'local',
      trustProxyHops: 1,
    });
  });
});
