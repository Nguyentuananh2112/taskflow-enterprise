import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { errorEnvelope } from './harness/http-client';
import { useApi } from './harness/suite';

// Lớp vận chuyển: chạy được ngay trên app thật (chưa cần route nghiệp vụ).
// Mọi POST tới `/api/v1/__sec-probe` đi qua toàn bộ chuỗi middleware trước khi tới 404.

const api = useApi();
const PROBE = '/api/v1/__sec-probe';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('SEC-30 — CORS whitelist chính xác', () => {
  it('origin trong whitelist: phản chiếu đúng origin + credentials', async () => {
    const res = await api.request({ path: '/healthz', headers: { origin: api.webOrigin } });
    expect(res.headers['access-control-allow-origin']).toBe(api.webOrigin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers.vary).toMatch(/origin/i);
  });

  const hostile = [
    'https://evil.example',
    'null',
    `${api.webOrigin}/`,
    `${api.webOrigin}.evil.example`,
    `${api.webOrigin}1`,
    'HTTP://LOCALHOST:3001',
    'https://localhost:3001',
    'http://127.0.0.1:3001',
  ];
  it.each(hostile)('origin lạ %s: không có Access-Control-Allow-Origin', async (origin) => {
    const res = await api.request({ path: '/healthz', headers: { origin } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('preflight từ origin lạ: không cấp quyền gọi PATCH có credentials', async () => {
    const res = await api.request({
      method: 'OPTIONS',
      path: PROBE,
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  // T-037: PUT (members/:userId/grants) + Idempotency-Key (check-in/out T-038) là thay đổi có chủ đích —
  // khẳng định ĐÚNG tập khai báo (không thừa, không thiếu), method / header lạ vẫn bị từ chối.
  const listOf = (h: string | undefined) =>
    (h ?? '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .sort();
  const preflight = (method: string, headers: string) =>
    api.request({
      method: 'OPTIONS',
      path: PROBE,
      headers: {
        origin: api.webOrigin,
        'access-control-request-method': method,
        'access-control-request-headers': headers,
      },
    });

  it('preflight hợp lệ: chỉ cho các method/header đã khai báo', async () => {
    const res = await preflight('PUT', 'authorization,content-type,idempotency-key');
    expect(res.headers['access-control-allow-origin']).toBe(api.webOrigin);
    expect(listOf(res.headers['access-control-allow-methods'])).toEqual(
      ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].map((m) => m.toLowerCase()),
    );
    expect(listOf(res.headers['access-control-allow-headers'])).toEqual([
      'authorization',
      'content-type',
      'idempotency-key',
      'x-client-id',
      'x-request-id',
    ]);
  });

  it('preflight method / header lạ (TRACE, X-Evil): không nằm trong tập cho phép, không có *', async () => {
    const res = await preflight('TRACE', 'x-evil');
    const methods = listOf(res.headers['access-control-allow-methods']);
    const headers = listOf(res.headers['access-control-allow-headers']);
    for (const bad of ['trace', 'connect', '*']) expect(methods).not.toContain(bad);
    for (const bad of ['x-evil', '*']) expect(headers).not.toContain(bad);
  });
});

describe('SEC-31 — giới hạn body và Content-Type', () => {
  it('JSON 200kb ⇒ 413 PAYLOAD_TOO_LARGE', async () => {
    const body = JSON.stringify({ pad: 'a'.repeat(200 * 1024) });
    const res = await api.request({
      method: 'POST',
      path: PROBE,
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(413);
    expect(errorEnvelope(res).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('bom gzip (50MB giải nén, ~50kb nén) ⇒ 413, không giải nén hết vào RAM', async () => {
    const bomb = gzipSync(Buffer.from(`{"pad":"${'0'.repeat(50 * 1024 * 1024)}"}`));
    expect(bomb.length).toBeLessThan(100 * 1024);
    const started = Date.now();
    const res = await api.request({
      method: 'POST',
      path: PROBE,
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: bomb,
    });
    // 415 (từ chối nén) cũng an toàn; điều không được phép là 2xx/404 (đã giải nén toàn bộ).
    expect([413, 415]).toContain(res.status);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it.each([
    ['text/plain', '{"a":1}'],
    ['application/x-www-form-urlencoded', 'a=1'],
    ['multipart/form-data; boundary=x', '--x--'],
    ['application/json-patch+json', '[]'],
  ])('POST với Content-Type %s ⇒ 415 (chống CSRF dạng simple request)', async (type, body) => {
    const res = await api.request({
      method: 'POST',
      path: PROBE,
      headers: { 'content-type': type },
      body,
    });
    expect(res.status).toBe(415);
    expect(errorEnvelope(res).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('POST không có Content-Type (kể cả body rỗng) ⇒ 415', async () => {
    const res = await api.request({ method: 'POST', path: PROBE });
    expect(res.status).toBe(415);
  });

  it('charset ngoài họ UTF (latin1) ⇒ 415', async () => {
    const res = await api.request({
      method: 'POST',
      path: PROBE,
      headers: { 'content-type': 'application/json; charset=iso-8859-1' },
      body: '{}',
    });
    expect(res.status).toBe(415);
    expect(errorEnvelope(res).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  // Findings A5: body-parser nhận mọi charset `utf-*` (iconv giải mã cả UTF-7/UTF-16) — RFC 8259
  // yêu cầu JSON trao đổi là UTF-8. Đỏ tới khi requireJsonContentType chỉ chấp nhận utf-8/không charset.
  it.each(['utf-7', 'utf-16le', 'utf-16be'])(
    'FINDING A5: charset=%s (không phải UTF-8) ⇒ 415',
    async (charset) => {
      const res = await api.request({
        method: 'POST',
        path: PROBE,
        headers: { 'content-type': `application/json; charset=${charset}` },
        body: '{}',
      });
      expect(res.status).toBe(415);
    },
  );

  it('JSON hỏng ⇒ 400 VALIDATION_ERROR, không phản chiếu input (ADR-096)', async () => {
    const secret = 'Sup3r-Secret-Passw0rd!';
    const res = await api.request({
      method: 'POST',
      path: PROBE,
      headers: { 'content-type': 'application/json' },
      body: `{"password":"${secret}",`,
    });
    expect(res.status).toBe(400);
    expect(errorEnvelope(res).error.code).toBe('VALIDATION_ERROR');
    expect(res.text).not.toContain(secret);
  });

  it('JSON gốc không phải object/array (strict) ⇒ 400', async () => {
    const res = await api.request({
      method: 'POST',
      path: PROBE,
      headers: { 'content-type': 'application/json' },
      body: '"just-a-string"',
    });
    expect(res.status).toBe(400);
  });
});

describe('Header bảo mật (helmet, security.md §6.2) — bổ trợ SEC-30/31', () => {
  it('API trả CSP chặt, nosniff, không X-Powered-By, CORP same-site, no-referrer', async () => {
    const res = await api.request({ path: PROBE });
    const csp = res.headers['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('HSTS tắt ngoài production (bật ở production — xem production.sec.ts)', async () => {
    const res = await api.request({ path: '/healthz' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('Lỗi & request id (security.md §6.7, devops.md §6.1)', () => {
  it('route lạ ⇒ 404 envelope, không phản chiếu path (chống XSS phản chiếu qua JSON)', async () => {
    const payload = '<script>alert(1)</script>';
    const res = await api.request({ path: `/api/v1/${encodeURIComponent(payload)}` });
    expect(res.status).toBe(404);
    expect(errorEnvelope(res).error.code).toBe('RESOURCE_NOT_FOUND');
    expect(res.text).not.toContain('<script>');
    expect(res.text).not.toContain('%3Cscript');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('X-Request-Id uuid hợp lệ được dùng lại (chữ thường); giá trị lạ bị thay bằng uuid mới', async () => {
    const id = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
    const ok = await api.request({ path: PROBE, headers: { 'x-request-id': id } });
    expect(ok.headers['x-request-id']).toBe(id.toLowerCase());
    expect(errorEnvelope(ok).meta.requestId).toBe(id.toLowerCase());

    const evil = await api.request({
      path: PROBE,
      headers: { 'x-request-id': 'x","level":60,"msg":"forged' },
    });
    expect(evil.headers['x-request-id']).toMatch(UUID);
    expect(api.logs().some((line) => line.includes('forged'))).toBe(false);
  });

  it('/healthz và /readyz không lộ chi tiết hạ tầng', async () => {
    const health = await api.request({ path: '/healthz' });
    // T-031 (Info của T-028): gitSha không còn ở /healthz công khai.
    expect(Object.keys(health.json as object).sort()).toEqual(['status']);
    const ready = await api.request({ path: '/readyz' });
    expect(ready.status).toBe(200);
    expect(Object.keys(ready.json as object).sort()).toEqual(['db', 'valkey']);
    expect(ready.text).not.toMatch(/postgres|redis:\/\/|password|ECONN/i);
  });
});

// SEC-29 (Origin trên /auth/refresh): xem auth.sec.ts.
