import * as fsp from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitedError } from '../../errors';
import type { ILogger } from '../../logging/logger';
import { avatarFileKey, type FileKey } from '../domain/file-key';
import { LocalFileStore } from '../infrastructure/local-file-store';
import { MediaUrlSigner } from '../media-url-signer';
import type { IMediaResolver, ResolvedMedia } from '../ports';
import { mediaErrorHtml, mediaRouter, type MediaRouterDeps } from './media-router';

const SECRET = 'test-only-file-url-secret-0123456789abcdef';
const OLD = 'test-only-file-url-secret-previous-0123456789';
const USER = '0b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a';
const ATT = '1b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a';
const NOW = new Date('2026-10-18T08:00:00.000Z');
const clock = { now: () => NOW };
const BACK = 'http://localhost:3001';

let root: string;
let store: LocalFileStore;
let avatarKey: FileKey;
let fileKey: FileKey;
let resolved: Map<string, ResolvedMedia>;
let server: http.Server | undefined;

const logger = () =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }) as unknown as ILogger;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tf-media-'));
  store = await LocalFileStore.create(root);
  avatarKey = (
    await store.put(Buffer.from('RIFF-webp-avatar'), {
      maxBytes: 1_000,
      key: avatarFileKey(USER, 3, '64'),
    })
  ).key;
  fileKey = (await store.put(Buffer.from('%PDF-1.4 nội dung'), { maxBytes: 1_000 })).key;
  resolved = new Map<string, ResolvedMedia>([
    [`avatars/${USER}/64/3`, { key: avatarKey, as: 'image' }],
    [`chat/${ATT}/file/1`, { key: fileKey, as: 'download', name: 'Báo cáo tháng 10.pdf' }],
  ]);
});
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await fsp.rm(root, { recursive: true, force: true });
});

function setup(over: Partial<MediaRouterDeps> = {}) {
  const resolve = vi.fn<IMediaResolver['resolve']>(({ kind, id, variant, version }) =>
    Promise.resolve(resolved.get(`${kind}/${id}/${variant}/${version}`) ?? null),
  );
  const resolver: IMediaResolver = { resolve };
  const open = vi.spyOn(store, 'open');
  const debug = vi.fn();
  const warn = vi.fn();
  const log = { ...logger(), debug, warn } as unknown as ILogger;
  const deps: MediaRouterDeps = {
    store,
    resolver,
    secrets: { current: SECRET, previous: OLD },
    clock,
    logger: log,
    corp: 'same-site',
    backUrl: BACK,
    ...over,
  };
  const app = express();
  app.use('/api/v1/media', mediaRouter(deps));
  return { app, resolve, open, debug, warn };
}

const signer = (secret = SECRET) =>
  new MediaUrlSigner(
    {
      baseUrl: 'http://api.test',
      secret,
      avatarBucketSec: 86_400,
      imageBucketSec: 3_600,
      downloadTtlSec: 60,
    },
    clock,
  );
const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};
const edit = (url: string, mutate: (u: URL) => void) => {
  const u = new URL(url);
  mutate(u);
  return `${u.pathname}${u.search}`;
};

describe('MediaUrlSigner', () => {
  it('URL tuyệt đối, path + v/exp/sig; khung 24 giờ cho avatar, 60 s cho tải tệp', () => {
    const url = new URL(signer().avatarUrl(USER, 3, '64'));
    expect(url.origin).toBe('http://api.test');
    expect(url.pathname).toBe(`/api/v1/media/avatars/${USER}/64`);
    const nowSec = NOW.getTime() / 1000;
    expect(Number(url.searchParams.get('exp')) - nowSec).toBeGreaterThanOrEqual(86_400);
    expect(Number(url.searchParams.get('exp')) - nowSec).toBeLessThanOrEqual(2 * 86_400);
    const dl = new URL(signer().downloadUrl(ATT));
    expect(Number(dl.searchParams.get('exp')) - nowSec).toBe(60);
    expect(dl.pathname.endsWith('/file')).toBe(true);
  });
});

describe('/media — phục vụ', () => {
  it('ảnh: webp inline, cache theo khung + ETag, header bảo vệ (SEC-CH-10)', async () => {
    const { app } = setup();
    const url = signer().avatarUrl(USER, 3, '64');
    const res = await request(app).get(pathOf(url));
    expect(res.status).toBe(200);
    const exp = Number(new URL(url).searchParams.get('exp'));
    expect(res.headers).toMatchObject({
      'content-type': 'image/webp',
      'content-disposition': 'inline',
      'cache-control': `private, max-age=${exp - NOW.getTime() / 1000}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-site',
    });
    expect(res.headers.etag).toBe(`"avatars-${USER}-64-3"`);
    expect(Buffer.from(res.body as Buffer).toString()).toBe('RIFF-webp-avatar');
    const again = await request(app)
      .get(pathOf(url))
      .set('If-None-Match', res.headers.etag ?? '');
    expect(again.status).toBe(304);
  });

  it('tệp: octet-stream + attachment + filename* tiếng Việt + no-store', async () => {
    const { app } = setup();
    const res = await request(app)
      .get(pathOf(signer().downloadUrl(ATT)))
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="Bao cao thang 10.pdf"; filename*=UTF-8''B%C3%A1o%20c%C3%A1o%20th%C3%A1ng%2010.pdf`,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength('%PDF-1.4 nội dung')));
  });

  it('CORP theo cấu hình: cross-origin có chủ ý (B M2)', async () => {
    const { app } = setup({ corp: 'cross-origin' });
    const res = await request(app).get(pathOf(signer().avatarUrl(USER, 3, '64')));
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('ký bằng khóa cũ trong lúc xoay (_PREVIOUS) ⇒ 200 (SEC-CH-35)', async () => {
    const { app } = setup();
    expect((await request(app).get(pathOf(signer(OLD).avatarUrl(USER, 3, '64')))).status).toBe(200);
  });
});

describe('/media — từ chối: 404 HTML giống hệt nhau, không lộ lý do (SEC-CH-11)', () => {
  const html = mediaErrorHtml(BACK);

  it.each<[string, (url: string) => string]>([
    [
      'sửa exp',
      (u) =>
        edit(u, (x) => x.searchParams.set('exp', String(Number(x.searchParams.get('exp')) + 1))),
    ],
    ['sửa sig', (u) => edit(u, (x) => x.searchParams.set('sig', `${'A'.repeat(42)}B`))],
    ['sửa v', (u) => edit(u, (x) => x.searchParams.set('v', '4'))],
    ['sửa variant', (u) => edit(u, (x) => (x.pathname = x.pathname.replace('/64', '/256')))],
    ['sửa kind', (u) => edit(u, (x) => (x.pathname = x.pathname.replace('/avatars/', '/chat/')))],
    ['sửa id', (u) => edit(u, (x) => (x.pathname = x.pathname.replace(USER, ATT)))],
  ])('%s ⇒ 404, KHÔNG chạm DB, KHÔNG chạm đĩa (F-10, SEC-CH-31)', async (_n, tamper) => {
    const { app, resolve, open, debug } = setup();
    const res = await request(app).get(tamper(signer().avatarUrl(USER, 3, '64')));
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'; sandbox",
    );
    expect(res.text).toBe(html);
    expect(resolve).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(debug.mock.calls.at(-1)?.[1]).toBe('media.sig_invalid');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('sig=');
  });

  it('URL hết hạn ⇒ 404 (lý do expired chỉ trong log debug)', async () => {
    const { app, debug } = setup({
      clock: { now: () => new Date(NOW.getTime() + 3 * 86_400_000) },
    });
    const res = await request(app).get(pathOf(signer().avatarUrl(USER, 3, '64')));
    expect([res.status, res.text]).toEqual([404, html]);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'expired' }),
      'media.sig_invalid',
    );
  });

  it.each([
    ['id không phải uuid', `/api/v1/media/avatars/abc/64?v=1&exp=9999999999&sig=${'a'.repeat(43)}`],
    ['thiếu sig', `/api/v1/media/avatars/${USER}/64?v=1&exp=9999999999`],
    ['tham số lạ', `/api/v1/media/avatars/${USER}/64?v=1&exp=9999999999&sig=${'a'.repeat(43)}&x=1`],
    ['kind lạ', `/api/v1/media/files/${USER}/64?v=1&exp=9999999999&sig=${'a'.repeat(43)}`],
    [
      'variant sai kind',
      `/api/v1/media/avatars/${USER}/file?v=1&exp=9999999999&sig=${'a'.repeat(43)}`,
    ],
    ['v = 0', `/api/v1/media/avatars/${USER}/64?v=0&exp=9999999999&sig=${'a'.repeat(43)}`],
  ])('%s ⇒ 404 qua zod trước chữ ký', async (_n, url) => {
    const { app, resolve } = setup();
    const res = await request(app).get(url);
    expect([res.status, res.text]).toEqual([404, html]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('chữ ký đúng nhưng DB nói không còn (tin đã xóa / avatar đổi version) ⇒ 404 ngay (SEC-CH-22)', async () => {
    resolved.clear();
    const { app, open } = setup();
    const res = await request(app).get(pathOf(signer().avatarUrl(USER, 3, '64')));
    expect([res.status, res.text]).toEqual([404, html]);
    expect(open).not.toHaveBeenCalled();
  });

  it('blob mất trên đĩa ⇒ 404 + log cảnh báo, không 500 (F-09, SEC-CH-31)', async () => {
    await store.delete(fileKey);
    const { app, warn } = setup();
    const res = await request(app).get(pathOf(signer().downloadUrl(ATT)));
    expect([res.status, res.text]).toEqual([404, html]);
    expect(warn.mock.calls.at(-1)?.[1]).toBe('media.blob_missing');
  });

  it('vượt hạn mức IP ⇒ 429 HTML + Retry-After', async () => {
    const limited: RequestHandler = (_req, _res, next) => next(new RateLimitedError(7));
    const { app } = setup({ rateLimit: limited });
    const res = await request(app).get(pathOf(signer().avatarUrl(USER, 3, '64')));
    expect([res.status, res.headers['retry-after'], res.text]).toEqual([429, '7', html]);
  });

  it('trang lỗi: không script, link "Quay lại" về web đã escape', () => {
    expect(html).not.toMatch(/<script|javascript:/i);
    expect(html).toContain(`<a href="${BACK}">Quay lại</a>`);
    expect(mediaErrorHtml('http://x/"><script>')).not.toContain('"><script>');
  });
});

describe('/media — client hủy giữa chừng (B L-b)', () => {
  it('stream của blob bị đóng (fd không rò)', async () => {
    const big = await store.put(Buffer.alloc(8 * 1024 * 1024, 7), { maxBytes: 10 * 1024 * 1024 });
    resolved.set(`chat/${ATT}/file/1`, { key: big.key, as: 'download', name: 'big.pdf' });
    let opened: Readable | undefined;
    const realOpen = store.open.bind(store);
    vi.spyOn(store, 'open').mockImplementation(async (key) => {
      const result = await realOpen(key);
      opened = result.stream;
      return result;
    });
    const { app } = setup();
    server = http.createServer(app);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => {
      const req = http.get(
        { port, host: '127.0.0.1', path: pathOf(signer().downloadUrl(ATT)) },
        (res) => {
          res.once('data', () => {
            req.destroy(); // đọc một chunk rồi bỏ đi
            resolve();
          });
        },
      );
      req.on('error', () => resolve());
    });
    const deadline = Date.now() + 2_000;
    while (!(opened?.destroyed ?? false) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    expect(opened?.destroyed).toBe(true);
  });
});
