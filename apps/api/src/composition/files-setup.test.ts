import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testEnvVars } from '../../test/support';
import { appConfigFromEnv, createApp } from '../app';
import { loadEnv } from '../config/env';
import { avatarFileKey } from '../core/files/domain/file-key';
import { FileStoreConfigError } from '../core/files/infrastructure/local-fs';
import type { ILogger } from '../core/logging/logger';
import { createLogger } from '../core/logging/pino-logger';
import { AppMetrics } from '../core/observability/metrics';
import { createFiles, type FilesBundle } from './files-setup';

const USER = '0b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a';
const clock = { now: () => new Date('2026-10-18T08:00:00.000Z') };
const quietLogger = () =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }) as unknown as ILogger;

let root: string;
let files: FilesBundle | undefined;
beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tf-files-setup-'));
});
afterEach(async () => {
  await files?.close();
  files = undefined;
  await fsp.rm(root, { recursive: true, force: true });
});

const envWith = (over: Record<string, string> = {}) =>
  loadEnv(
    testEnvVars({
      FILE_STORE_DIR: root,
      FILE_URL_SECRET: 'f'.repeat(40),
      FILES_IMAGE_PIPELINE_DISABLED: '1',
      ...over,
    }),
  );

describe('createFiles + createApp — /media gắn đúng chỗ (ADR-141)', () => {
  it('header của /media KHÔNG bị helmet / no-store toàn cục ghi đè; resolver đăng ký theo kind', async () => {
    const env = envWith({ MEDIA_CORP: 'cross-origin' });
    files = await createFiles({
      env,
      clock,
      logger: quietLogger(),
      webOrigin: 'http://localhost:3001',
    });
    const { key } = await files.store.put(Buffer.from('webp'), {
      maxBytes: 100,
      key: avatarFileKey(USER, 2, '64'),
    });
    files.resolvers.register('avatars', { resolve: () => Promise.resolve({ key, as: 'image' }) });
    const app = createApp({
      config: appConfigFromEnv(env),
      logger: createLogger({ level: 'silent', gitSha: 't', appEnv: 'test' }),
      clock,
      probes: [],
      isShuttingDown: () => false,
      media: files.media,
    });
    const url = new URL(files.signer.avatarUrl(USER, 2, '64'));
    expect(url.origin).toBe('http://localhost:4000');
    const res = await request(app).get(`${url.pathname}${url.search}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'; sandbox",
    );
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
    expect(res.headers['content-type']).toBe('image/webp');
    // Không phải JSON envelope: /media nằm TRƯỚC requireJsonContentType + no-store + 404 JSON.
    const missing = await request(app).get(
      `/api/v1/media/avatars/${USER}/64?v=9&exp=1&sig=${'a'.repeat(43)}`,
    );
    expect([missing.status, missing.headers['content-type']]).toEqual([
      404,
      'text/html; charset=utf-8',
    ]);
  });

  it('URL ký bằng FILE_URL_SECRET_PREVIOUS vẫn kiểm được (xoay khóa)', async () => {
    const env = envWith({
      FILE_URL_SECRET: 'n'.repeat(40),
      FILE_URL_SECRET_PREVIOUS: 'f'.repeat(40),
    });
    files = await createFiles({ env, clock, logger: quietLogger(), webOrigin: 'http://w' });
    const old = await createFiles({
      env: envWith(),
      clock,
      logger: quietLogger(),
      webOrigin: 'http://w',
    });
    const { key } = await files.store.put(Buffer.from('x'), {
      maxBytes: 10,
      key: avatarFileKey(USER, 1, '64'),
    });
    files.resolvers.register('avatars', { resolve: () => Promise.resolve({ key, as: 'image' }) });
    const url = new URL(old.signer.avatarUrl(USER, 1, '64'));
    await old.close();
    const app = createApp({
      config: appConfigFromEnv(env),
      logger: createLogger({ level: 'silent', gitSha: 't', appEnv: 'test' }),
      clock,
      probes: [],
      isShuttingDown: () => false,
      media: files.media,
    });
    expect((await request(app).get(`${url.pathname}${url.search}`)).status).toBe(200);
  });
});

describe('createFiles — khởi động', () => {
  it('FILE_STORE_DIR không tồn tại ⇒ từ chối khởi động', async () => {
    const env = envWith({ FILE_STORE_DIR: path.join(root, 'missing') });
    await expect(
      createFiles({ env, clock, logger: quietLogger(), webOrigin: 'http://w' }),
    ).rejects.toBeInstanceOf(FileStoreConfigError);
  });

  it('FILE_STORE_DIR nằm trong thư mục ứng dụng (cwd) ⇒ từ chối khởi động', async () => {
    const inside = await fsp.mkdtemp(path.join(process.cwd(), '.tf-files-inside-'));
    try {
      await expect(
        createFiles({
          env: envWith({ FILE_STORE_DIR: inside }),
          clock,
          logger: quietLogger(),
          webOrigin: 'http://w',
        }),
      ).rejects.toThrow(/thư mục ứng dụng/);
    } finally {
      await fsp.rm(inside, { recursive: true, force: true });
    }
  });

  it('local/test không đặt FILE_URL_SECRET ⇒ khóa ngẫu nhiên + cảnh báo', async () => {
    const logger = quietLogger();
    const env = loadEnv(testEnvVars({ FILE_STORE_DIR: root, FILES_IMAGE_PIPELINE_DISABLED: '1' }));
    files = await createFiles({ env, clock, logger, webOrigin: 'http://w' });
    expect(vi.mocked(logger.warn).mock.calls.map((c) => (c as unknown[])[1])).toContain(
      'files.url_secret_ephemeral',
    );
  });

  it('AV-06: FILES_IMAGE_PIPELINE_DISABLED ⇒ selfTest false, gauge files_image_worker_up = 0, log lỗi', async () => {
    const logger = quietLogger();
    const metrics = new AppMetrics({ defaultMetrics: false });
    files = await createFiles({ env: envWith(), clock, logger, metrics, webOrigin: 'http://w' });
    expect(await metrics.registry.metrics()).toMatch(/^files_image_worker_up -1$/m); // chưa kiểm
    files.startHealthChecks();
    await vi.waitFor(() =>
      expect(vi.mocked(logger.error).mock.calls.map((c) => (c as unknown[])[1])).toContain(
        'files.image_pipeline_unavailable',
      ),
    );
    const text = await metrics.registry.metrics();
    expect(text).toMatch(/^files_image_worker_up 0$/m);
  });

  it('cửa sổ test-only được áp: URL tải tệp sống đúng MEDIA_URL_DOWNLOAD_TTL_SECONDS', async () => {
    files = await createFiles({
      env: envWith({ MEDIA_URL_DOWNLOAD_TTL_SECONDS: '3' }),
      clock,
      logger: quietLogger(),
      webOrigin: 'http://w',
    });
    const exp = Number(new URL(files.signer.downloadUrl(USER)).searchParams.get('exp'));
    expect(exp - clock.now().getTime() / 1000).toBe(3);
  });
});

describe('createFiles — files-sweep (ADR-141)', () => {
  it.each([
    ['local/test mặc định ⇒ tắt', {}, undefined],
    [
      'FILES_SWEEP_INTERVAL_MS (test) ⇒ bật, đúng chu kỳ',
      { FILES_SWEEP_INTERVAL_MS: '1000' },
      1_000,
    ],
    [
      'FILES_SWEEP_ON_START (test) ⇒ bật, chu kỳ mặc định',
      { FILES_SWEEP_ON_START: 'true' },
      3_600_000,
    ],
    ['MAINTENANCE_JOBS_ENABLED=true ⇒ bật', { MAINTENANCE_JOBS_ENABLED: 'true' }, 3_600_000],
  ])('%s', async (_n, over, interval) => {
    files = await createFiles({
      env: envWith(over),
      clock,
      logger: quietLogger(),
      webOrigin: 'http://w',
    });
    expect(files.sweepJob?.intervalMs).toBe(interval);
    if (files.sweepJob) expect(files.sweepJob.name).toBe('files-sweep');
  });
});
