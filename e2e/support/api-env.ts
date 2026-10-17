import { loadHarnessConfig, postgresUrl } from '../../apps/api/test/security/harness/config';
import {
  API_PORT,
  E2E_CLOCK_ANCHOR,
  E2E_DB,
  E2E_JWT_SECRET,
  E2E_REDIS_URL,
  WEB_ORIGIN,
} from './env';

/**
 * Env của API E2E — dùng chung cho webServer (playwright.config.ts) và `admin:bootstrap` ở globalSetup (Mốc 3.5,
 * ADR-140): CLI phải thấy CÙNG DB, Valkey, `APP_ENV=test` và `TEST_CLOCK_ANCHOR` với API.
 */
export function apiServerEnv(): Record<string, string> {
  const db = loadHarnessConfig({ ...process.env, SEC_PG_DB: E2E_DB, SEC_REDIS_URL: E2E_REDIS_URL });
  return {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    PORT: String(API_PORT),
    // Cổng metrics nội bộ do OS chọn: mặc định 9464 trùng dev API (4000) đang chạy ⇒ một trong hai
    // EADDRINUSE (2026-10-16: dev API của người dùng khởi động lại thất bại vì E2E giữ 9464).
    METRICS_PORT: '0',
    DATABASE_URL: postgresUrl(db, 'app'),
    REDIS_URL: E2E_REDIS_URL,
    JWT_ACCESS_SECRET: E2E_JWT_SECRET,
    CORS_ORIGINS: WEB_ORIGIN,
    COOKIE_SECURE: 'false',
    TRUST_PROXY_HOPS: '0',
    GIT_SHA: 'e2e',
    LOG_LEVEL: 'warn',
    // E2E-11: access token sống ngắn ⇒ mọi kịch bản dài đều đi qua refresh trong suốt. API chỉ nhận
    // biến này khi APP_ENV=test (T-031); bản API chưa có thì bỏ qua (E2E-11 tự skip có nhãn).
    JWT_ACCESS_TTL_SECONDS: process.env.E2E_ACCESS_TTL ?? '10',
    // Giờ nghiệp vụ tất định (TL d9, A fix/T-038-test-clock): neo + trôi; auth/limiter vẫn giờ thật.
    TEST_CLOCK_ANCHOR: E2E_CLOCK_ANCHOR,
  };
}
