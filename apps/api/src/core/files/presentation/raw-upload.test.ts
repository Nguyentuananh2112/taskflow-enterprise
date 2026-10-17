import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../errors';
import { requireJsonContentType } from '../../http/middleware';
import type { FileKey } from '../domain/file-key';
import { LocalFileStore } from '../infrastructure/local-file-store';
import { StorageQuota } from '../storage-quota';
import { UploadSlots } from '../upload-slots';
import { rawUpload, requireUpload, type RawUploadOptions } from './raw-upload';

const MAX = 64 * 1024;
let root: string;
let store: LocalFileStore;
let slots: UploadSlots;
let server: http.Server | undefined;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tf-rawupload-'));
  store = await LocalFileStore.create(root);
  slots = new UploadSlots();
});
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await fsp.rm(root, { recursive: true, force: true });
});

const tmpFiles = () => fsp.readdir(path.join(root, 'tmp'));
async function waitNoTmp(within = 2_000): Promise<void> {
  const deadline = Date.now() + within;
  while ((await tmpFiles()).length > 0) {
    if (Date.now() > deadline) throw new Error(`tmp còn ${(await tmpFiles()).join(',')}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function waitFor(check: () => boolean, within = 2_000): Promise<void> {
  const deadline = Date.now() + within;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('hết giờ chờ');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const errors: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).set(err.headers).json({ code: err.code });
  } else res.status(500).json({ code: 'INTERNAL_ERROR' });
};

function build(over: Partial<RawUploadOptions> = {}) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', sid: 's' };
    next();
  });
  app.use(requireJsonContentType);
  app.use(express.json());
  const upload = rawUpload({
    store,
    slots,
    maxBytes: MAX,
    idleTimeoutMs: 1_000,
    totalTimeoutMs: 5_000,
    drainTimeoutMs: 300,
    drainMaxBytes: 256 * 1024,
    ...over,
  });
  app.put('/api/v1/me/avatar', upload, (req, res) => {
    const { name, staged } = requireUpload(req);
    res.json({ name, sizeBytes: staged.sizeBytes, sha256: staged.sha256 });
  });
  app.post('/api/v1/chat/uploads', upload, async (req, res) => {
    const { staged } = requireUpload(req);
    const head = await staged.read(0, 4); // đọc qua wrapper (quota) — phải gọi được trên instance thật
    const all = await staged.readAll();
    const stored = await staged.commit('chat');
    res.status(201).json({ key: stored.key, head: head.length, size: all.length });
  });
  app.post('/api/v1/other', (_req, res) => res.json({ ok: true }));
  app.use(errors);
  return app;
}

async function listen(over: Partial<RawUploadOptions> = {}): Promise<number> {
  const created = http.createServer(build(over));
  server = created;
  await new Promise<void>((r) => created.listen(0, '127.0.0.1', () => r()));
  return (created.address() as AddressInfo).port;
}

interface RawResult {
  status?: number | undefined;
  connection?: string | undefined;
  socketError?: string;
  body?: string;
}

/** Request thô: `write` quyết định byte gửi; trả status (nếu có) + cách kết thúc của socket. */
function rawRequest(
  port: number,
  headers: Record<string, string>,
  write: (req: http.ClientRequest) => void,
): Promise<RawResult> {
  return new Promise((resolve) => {
    const req = http.request({
      port,
      host: '127.0.0.1',
      method: 'PUT',
      path: '/api/v1/me/avatar',
      headers: { 'content-type': 'application/octet-stream', 'x-upload-name': 'a.png', ...headers },
    });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () =>
        resolve({ status: res.statusCode, connection: res.headers.connection, body }),
      );
      res.on('error', () => resolve({ status: res.statusCode }));
    });
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ socketError: e.code ?? e.message }));
    write(req);
  });
}

const octet = (r: request.Test, name = 'Ảnh đại diện.png') =>
  r.set('Content-Type', 'application/octet-stream').set('X-Upload-Name', encodeURIComponent(name));

describe('rawUpload — luồng chính', () => {
  it('nhận body nhị phân: tên đã làm sạch, kích thước + SHA-256; response đóng ⇒ bản tạm bị bỏ', async () => {
    const data = Buffer.alloc(10_000, 9);
    const res = await octet(request(build()).put('/api/v1/me/avatar'), '../x‮.png').send(data);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'x.png',
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
    await waitNoTmp();
    expect(slots.inFlight('user-1')).toBe(0);
  });

  it('commit trong handler ⇒ blob ở lại, tmp sạch', async () => {
    const res = await octet(request(build()).post('/api/v1/chat/uploads')).send(Buffer.from('x'));
    expect(res.status).toBe(201);
    expect(await store.exists((res.body as { key: FileKey }).key)).toBe(true);
    await waitNoTmp();
  });
});

describe('rawUpload — thứ tự lỗi trước khi đọc body', () => {
  it.each([
    ['multipart/form-data; boundary=x'],
    ['text/plain'],
    ['application/x-www-form-urlencoded'],
  ])('Content-Type %s ⇒ 415 (SEC-CH-12)', async (type) => {
    const res = await request(build())
      .put('/api/v1/me/avatar')
      .set('Content-Type', type)
      .set('X-Upload-Name', 'a.png')
      .send('abc');
    expect(res.status).toBe(415);
    expect(await tmpFiles()).toEqual([]);
  });

  it('JSON tới route upload ⇒ 415 ở rawUpload, kèm Connection: close (B L1)', async () => {
    const res = await request(build()).put('/api/v1/me/avatar').send({ a: 1 });
    expect([res.status, (res.body as { code: string }).code]).toEqual([
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ]);
    expect(res.headers.connection).toBe('close');
  });

  it.each([
    ['thiếu', undefined],
    ['percent hỏng', '%E0%A4%A'],
    ['256 byte', encodeURIComponent(`${'ệ'.repeat(85)}.p`)],
  ])('X-Upload-Name %s ⇒ 400 INVALID_UPLOAD_NAME, không ghi (SEC-CH-09)', async (_n, header) => {
    let r = request(build())
      .put('/api/v1/me/avatar')
      .set('Content-Type', 'application/octet-stream');
    if (header !== undefined) r = r.set('X-Upload-Name', header);
    const res = await r.send(Buffer.from('abc'));
    expect([res.status, (res.body as { code: string }).code]).toEqual([400, 'INVALID_UPLOAD_NAME']);
    expect(await tmpFiles()).toEqual([]);
  });

  it('Content-Length > trần ⇒ 413 + Connection: close, không tạo tmp', async () => {
    const port = await listen();
    const result = await rawRequest(port, { 'content-length': String(MAX + 1) }, (req) => {
      req.end(Buffer.alloc(MAX + 1));
    });
    expect(result.status).toBe(413);
    expect(result.connection).toBe('close');
    expect(await tmpFiles()).toEqual([]);
  });

  it('upload thứ 4 đồng thời ⇒ 429 + Retry-After (SEC-CH-24); lượt được nhả khi response đóng', async () => {
    const held = [1, 2, 3].map(() => slots.tryAcquire('user-1'));
    const res = await octet(request(build()).put('/api/v1/me/avatar')).send(Buffer.from('x'));
    expect([res.status, (res.body as { code: string }).code, res.headers['retry-after']]).toEqual([
      429,
      'RATE_LIMITED',
      '5',
    ]);
    held.forEach((release) => release?.());
    expect(slots.inFlight('user-1')).toBe(0);
    const ok = await octet(request(build()).put('/api/v1/me/avatar')).send(Buffer.from('x'));
    expect(ok.status).toBe(200);
  });
});

describe('rawUpload — trần kho (SEC-CH-14 vế STORAGE_FULL)', () => {
  it('kho gần đầy ⇒ 507 STORAGE_FULL trước khi tạo tmp; commit cộng ngay vào số đã dùng', async () => {
    const quota = new StorageQuota(() => Promise.resolve(0), 25, 60_000);
    const app = build({ quota });
    const ok = await octet(request(app).post('/api/v1/chat/uploads')).send(Buffer.alloc(20, 1));
    expect(ok.status).toBe(201);
    expect(await quota.usedBytes()).toBe(20);
    const full = await octet(request(app).post('/api/v1/chat/uploads')).send(Buffer.alloc(10, 1));
    expect([full.status, (full.body as { code: string }).code]).toEqual([507, 'STORAGE_FULL']);
    expect(full.headers.connection).toBe('close');
    expect(await tmpFiles()).toEqual([]);
  });
});

describe('rawUpload — luồng body (SEC-CH-08/26/27)', () => {
  it('chunked vượt trần giữa chừng ⇒ client NHẬN 413, tmp rỗng, socket đóng', async () => {
    const port = await listen();
    const result = await rawRequest(port, {}, (req) => {
      const chunk = Buffer.alloc(16 * 1024, 1);
      for (let i = 0; i < 8; i++) req.write(chunk); // 128 KiB > 64 KiB, không Content-Length
      req.end();
    });
    expect(result.status).toBe(413);
    expect(result.connection).toBe('close');
    await waitNoTmp();
    expect(slots.inFlight('user-1')).toBe(0);
  });

  it('sau 413, client gửi mãi ⇒ bị cắt trong trần xả (thời gian / byte)', async () => {
    const port = await listen({ drainTimeoutMs: 300, drainMaxBytes: 10 * 1024 * 1024 });
    const started = Date.now();
    let stop = false;
    const result = await rawRequest(port, {}, (req) => {
      const chunk = Buffer.alloc(16 * 1024, 1);
      const pump = () => {
        if (stop || req.destroyed) return;
        req.write(chunk);
        setTimeout(pump, 10);
      };
      pump();
    });
    stop = true;
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.status === 413 || result.socketError !== undefined).toBe(true);
    await waitNoTmp();
  });

  it('client hủy ở 50 % ⇒ ≤ 2 s không còn tmp, lượt được nhả (SEC-CH-26)', async () => {
    const port = await listen();
    await rawRequest(port, { 'content-length': String(MAX) }, (req) => {
      req.write(Buffer.alloc(MAX / 2, 1));
      setTimeout(() => req.destroy(), 100);
    });
    await waitNoTmp(2_000);
    await waitFor(() => slots.inFlight('user-1') === 0);
  });

  it('im lặng quá UPLOAD_IDLE_TIMEOUT_MS ⇒ cắt kết nối, không sót tmp (SEC-CH-27)', async () => {
    const port = await listen({ idleTimeoutMs: 200 });
    const started = Date.now();
    const result = await rawRequest(port, { 'content-length': String(MAX) }, (req) => {
      req.write(Buffer.alloc(1_000, 1)); // rồi im
    });
    expect(result.socketError ?? `status ${result.status}`).toBeDefined();
    expect(result.status).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_500);
    await waitNoTmp();
    await waitFor(() => slots.inFlight('user-1') === 0);
  });

  it('nhỏ giọt vượt tổng thời gian ⇒ cắt kết nối, không sót tmp', async () => {
    const port = await listen({ idleTimeoutMs: 1_000, totalTimeoutMs: 300 });
    const started = Date.now();
    const result = await rawRequest(port, { 'content-length': String(MAX) }, (req) => {
      const drip = () => {
        if (req.destroyed) return;
        req.write(Buffer.alloc(64, 1));
        setTimeout(drip, 30);
      };
      drip();
    });
    expect(result.status).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_500);
    await waitNoTmp();
  });
});

describe('rawUpload — backpressure không phải im lặng (B L2)', () => {
  it('kho ghi chậm hơn idle timeout ⇒ req bị pause nhưng upload vẫn xong', async () => {
    // Kho giả: đọc từng chunk rồi "ghi" 150 ms — lâu hơn idle 100 ms ⇒ backpressure dừng `data` của req.
    const slowStore = {
      async stage(data: NodeJS.ReadableStream) {
        let size = 0;
        for await (const chunk of data as AsyncIterable<Buffer>) {
          size += chunk.length;
          await new Promise((r) => setTimeout(r, 150));
        }
        return {
          size,
          sizeBytes: size,
          sha256: '',
          head: Buffer.alloc(0),
          read: () => Promise.resolve(new Uint8Array()),
          readAll: () => Promise.resolve(Buffer.alloc(0)),
          commit: () => Promise.reject(new Error('không dùng')),
          discard: () => Promise.resolve(),
        };
      },
    } as unknown as RawUploadOptions['store'];
    const port = await listen({ store: slowStore, idleTimeoutMs: 100, totalTimeoutMs: 10_000 });
    const result = await rawRequest(port, { 'content-length': String(MAX) }, (req) => {
      req.end(Buffer.alloc(MAX, 1)); // gửi hết một lần ⇒ socket đầy, req bị pause chờ kho
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body ?? '{}')).toMatchObject({ sizeBytes: MAX });
  });
});

describe('requireJsonContentType — ngoại lệ đúng cặp method + path (B M1, SEC-CH-34)', () => {
  it.each([
    ['POST', '/api/v1/other'],
    ['POST', '/api/v1/me/avatar'],
    ['PUT', '/api/v1/chat/uploads'],
    ['PATCH', '/api/v1/me/avatar'],
  ])('octet-stream tới %s %s ⇒ 415', async (method, url) => {
    const app = express();
    app.use(requireJsonContentType);
    app.all('/{*any}', (_req, res) => res.json({ ok: true }));
    app.use(errors);
    const res = await request(app)
      [method.toLowerCase() as 'post'](url)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'));
    expect(res.status).toBe(415);
  });

  it.each(['/api/v1/me/avatar', '/api/v1/me/avatar/', '/API/V1/ME/AVATAR'])(
    'PUT %s octet-stream đi qua (cùng chuẩn hóa với định tuyến Express)',
    async (url) => {
      const app = express();
      app.use(requireJsonContentType);
      app.all('/{*any}', (_req, res) => res.json({ ok: true }));
      app.use(errors);
      const res = await request(app)
        .put(url)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('x'));
      expect(res.status).toBe(200);
    },
  );
});
