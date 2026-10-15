import { describe, expect, it } from 'vitest';

import { errorEnvelope } from './harness/http-client';
import { useApi } from './harness/suite';

// Cùng process thật nhưng NODE_ENV=production (env.ts bắt buộc đủ biến prod). Valkey `rediss://`
// cố ý không kết nối được ở local ⇒ chỉ ảnh hưởng readyz (degraded, ADR-074), không chặn khởi động.

const PROD_ORIGIN = 'https://app.sec.example';
const api = useApi({
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  REDIS_URL: 'rediss://127.0.0.1:6380',
  CORS_ORIGINS: PROD_ORIGIN,
  COOKIE_SECURE: 'true',
  TRUST_PROXY_HOPS: '1',
  JWT_ACCESS_SECRET: 'staging-like-secret-for-security-suite-0123456789',
  SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0',
  METRICS_TOKEN: 'm'.repeat(32),
});

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
