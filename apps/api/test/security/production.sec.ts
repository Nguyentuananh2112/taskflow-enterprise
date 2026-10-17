import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { errorEnvelope } from './harness/http-client';
import { useApi } from './harness/suite';

// Cùng process thật nhưng NODE_ENV=production (env.ts bắt buộc đủ biến prod). Valkey `rediss://`
// cố ý không kết nối được ở local ⇒ chỉ ảnh hưởng readyz (degraded, ADR-074), không chặn khởi động.

const PROD_ORIGIN = 'https://app.sec.example';
/** Kho tệp bắt buộc ở staging/production (T-067) — thư mục tạm thật, xóa sau suite (F). */
const FILES_DIR = mkdtempSync(join(tmpdir(), 'tf-sec-prod-files-'));
afterAll(() => rmSync(FILES_DIR, { recursive: true, force: true }));
const api = useApi(
  {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    REDIS_URL: 'rediss://127.0.0.1:6380',
    CORS_ORIGINS: PROD_ORIGIN,
    COOKIE_SECURE: 'true',
    TRUST_PROXY_HOPS: '1',
    JWT_ACCESS_SECRET: 'staging-like-secret-for-security-suite-0123456789',
    SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0',
    METRICS_TOKEN: 'm'.repeat(32),
    // Mốc 6 (T-067): kho tệp bắt buộc ở staging/production — thư mục tạm THẬT (prepareStoreRoot kiểm ghi / hard link).
    FILE_STORE_DIR: FILES_DIR,
    FILE_URL_SECRET: 'file-url-secret-for-security-suite-0123456789',
    MEDIA_BASE_URL: 'https://api.sec.example',
  },
  {
    // T-021: main.ts từ chối lưu trữ bộ nhớ ở production (guard đúng) ⇒ skip có nhãn tới khi có Prisma.
    // CI sau T-020: SEC_REQUIRE_PRODUCTION=1 ⇒ file này BẮT BUỘC chạy, khởi động lỗi là đỏ.
    label: 'PENDING-T020',
    startupRefusal: /Lưu trữ bộ nhớ không được dùng ở production/,
    requiredEnv: 'SEC_REQUIRE_PRODUCTION',
  },
);

describe('Production hardening', () => {
  it('HSTS bật: max-age 1 năm + includeSubDomains', async () => {
    const res = await api.request({ path: '/healthz' });
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/);
    expect(res.headers['strict-transport-security']).toMatch(/includeSubDomains/);
  });

  it('origin dev (http://localhost:3001) KHÔNG được CORS ở production', async () => {
    const res = await api.request({
      path: '/healthz',
      headers: { origin: 'http://localhost:3001' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('lỗi client không kèm details.debug / stack', async () => {
    const res = await api.request({
      method: 'POST',
      path: '/api/v1/__sec-probe',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    });
    expect(res.status).toBe(400);
    expect(errorEnvelope(res).error.details).not.toHaveProperty('debug');
    expect(res.text).not.toMatch(/at .+\.(ts|js):\d+/);
  });

  it('Valkey không kết nối được ⇒ readyz vẫn 200 (degraded), không 503 (ADR-074)', async () => {
    const res = await api.request({ path: '/readyz' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ db: 'ok', valkey: 'degraded' });
  });
});
