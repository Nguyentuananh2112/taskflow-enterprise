import { loadHarnessConfig, TEST_JWT_SECRET } from './config';

/**
 * Env tối thiểu hợp lệ cho NODE_ENV=test; `overrides` để dựng biến thể (vd production).
 * Không import vitest — dùng được cả trong globalSetup.
 */
export function baseEnv(dbUrl: string, overrides: Record<string, string> = {}) {
  const config = loadHarnessConfig();
  return {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: dbUrl,
    REDIS_URL: config.redisUrl,
    JWT_ACCESS_SECRET: TEST_JWT_SECRET,
    CORS_ORIGINS: config.webOrigin,
    COOKIE_SECURE: 'false',
    // 1 hop: harness gán X-Forwarded-For riêng cho mỗi request chưa xác thực (né rate limit
    // register 5/giờ/IP khi seed nhiều user). rate-limit.sec.ts ghi đè lại 0.
    TRUST_PROXY_HOPS: '1',
    GIT_SHA: 'security-suite',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}
