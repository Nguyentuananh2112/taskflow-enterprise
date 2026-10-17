import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ApiUnderTest } from './suite';
import { parseSignedUrl, upload } from './upload';

// Harness Mốc 6 (test-spec-chat §1.1): `upload()` gửi đúng header / thân, chunked, hủy giữa chừng, gửi chậm — kiểm
// bằng server HTTP cục bộ ghi lại request (không cần API).

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  bytes: number;
  aborted: boolean;
}
const seen: Seen[] = [];
let server: Server;
let api: ApiUnderTest;

beforeAll(async () => {
  server = createServer((req, res) => {
    const rec: Seen = {
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      bytes: 0,
      aborted: false,
    };
    seen.push(rec);
    req.on('data', (c: Buffer) => (rec.bytes += c.length));
    req.on('aborted', () => (rec.aborted = true));
    req.on('close', () => {
      if (!req.complete) rec.aborted = true;
    });
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { bytes: rec.bytes } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  api = {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    webOrigin: 'http://localhost:3001',
    request: () => Promise.reject(new Error('không dùng')),
    logs: () => [],
    restart: () => Promise.resolve(),
  };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const last = () => seen.at(-1) as Seen;

describe('harness upload', () => {
  it('mặc định: POST /api/v1/chat/uploads?as=, octet-stream, Bearer, Origin, X-Upload-Name percent-encoded, Content-Length', async () => {
    const body = Buffer.alloc(1000, 7);
    const res = await upload(api, 'tok', body, { as: 'file', name: 'Báo cáo tháng 10.pdf' });
    expect(res.status).toBe(201);
    expect(last()).toMatchObject({
      method: 'POST',
      url: '/api/v1/chat/uploads?as=file',
      bytes: 1000,
    });
    expect(last().headers).toMatchObject({
      'content-type': 'application/octet-stream',
      authorization: 'Bearer tok',
      origin: 'http://localhost:3001',
      'x-upload-name': encodeURIComponent('Báo cáo tháng 10.pdf'),
      'content-length': '1000',
    });
  });

  it('avatar: PUT /api/v1/me/avatar; name null ⇒ không có X-Upload-Name; rawName gửi nguyên', async () => {
    await upload(api, 'tok', Buffer.alloc(10), { path: '/me/avatar', name: null });
    expect(last().method).toBe('PUT');
    expect(last().headers['x-upload-name']).toBeUndefined();
    await upload(api, 'tok', Buffer.alloc(10), { rawName: '%E0%A4%A' });
    expect(last().headers['x-upload-name']).toBe('%E0%A4%A');
  });

  it('chunked: không Content-Length, Transfer-Encoding chunked, đủ byte', async () => {
    await upload(api, 'tok', Buffer.alloc(300_000, 1), { chunked: true });
    expect(last().headers['content-length']).toBeUndefined();
    expect(last().headers['transfer-encoding']).toBe('chunked');
    expect(last().bytes).toBe(300_000);
  });

  it('abortAt: server thấy kết nối bị hủy, nhận ≤ abortAt byte', async () => {
    const res = await upload(api, 'tok', Buffer.alloc(400_000, 2), { abortAt: 200_000 });
    expect(res).toMatchObject({ aborted: true, status: 0 });
    await expect.poll(() => last().aborted).toBe(true);
    expect(last().bytes).toBeLessThanOrEqual(200_000);
  });

  it('dripBps: gửi chậm theo nhịp (≥ 0,5 s cho 2 KB ở 2 KB/s)', async () => {
    const t0 = Date.now();
    await upload(api, 'tok', Buffer.alloc(2048, 3), { dripBps: 2048 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
    expect(last().bytes).toBe(2048);
  });

  it('không token ⇒ không Authorization; contentType ghi đè', async () => {
    await upload(api, undefined, Buffer.alloc(5), { contentType: 'text/plain' });
    expect(last().headers.authorization).toBeUndefined();
    expect(last().headers['content-type']).toBe('text/plain');
  });
});

describe('parseSignedUrl', () => {
  it('tách v / exp / sig và dựng lại với từng phần thay đổi', () => {
    const u = parseSignedUrl('/api/v1/media/chat/abc/preview?v=1&exp=1700000000&sig=AAA');
    expect(u).toMatchObject({
      path: '/api/v1/media/chat/abc/preview',
      v: '1',
      exp: '1700000000',
      sig: 'AAA',
    });
    expect(u.with({ exp: '1700000001' })).toBe(
      '/api/v1/media/chat/abc/preview?v=1&exp=1700000001&sig=AAA',
    );
    expect(u.with({ path: '/api/v1/media/chat/abc/thumb' })).toContain('/thumb?');
  });
});
