/** Bộ biến môi trường hợp lệ tối thiểu cho test `loadEnv` / composition root. Không phải secret thật. */
export function testEnvVars(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://taskflow_app:test@127.0.0.1:5433/taskflow_test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: 'test-only-jwt-secret-0123456789abcdef',
    CORS_ORIGINS: 'http://localhost:3001',
    COOKIE_SECURE: 'false',
    TRUST_PROXY_HOPS: '0',
    GIT_SHA: 'test-sha',
    // T-035: cổng metrics do OS chọn — nhiều tiến trình API (startup test, suite bảo mật) không đụng nhau.
    METRICS_PORT: '0',
    ...overrides,
  };
}

/** Biến production hợp lệ — test từng ràng buộc bằng cách ghi đè một biến. */
export function productionEnvVars(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return testEnvVars({
    NODE_ENV: 'production',
    APP_ENV: 'production',
    REDIS_URL: 'rediss://valkey.internal:6380',
    CORS_ORIGINS: 'https://app.example.com',
    COOKIE_SECURE: 'true',
    TRUST_PROXY_HOPS: '1',
    JWT_ACCESS_SECRET: 'prod-like-secret-for-env-validation-only-0123',
    SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
    METRICS_TOKEN: 'm'.repeat(32),
    // Mốc 6 (ADR-141): bắt buộc khi triển khai.
    FILE_STORE_DIR: '/var/lib/taskflow/files',
    FILE_URL_SECRET: 'prod-like-file-url-secret-for-env-validation-01',
    MEDIA_BASE_URL: 'https://api.example.com',
    ...overrides,
  });
}

/** Mặc định local: Valkey của compose `taskflow` (ADR-097). */
const DEFAULT_VALKEY_URL_TEST = 'redis://127.0.0.1:6380';
const warned = new Set<string>();

/**
 * URL Valkey cho test tầng I. Tên chuẩn `VALKEY_URL_TEST` — cùng mẫu `DATABASE_URL_TEST` (T-022).
 * `TEST_VALKEY_URL` (tên cũ của T-016) vẫn đọc trong Phase 3 kèm cảnh báo deprecated; gỡ ở Phase 4.
 */
export function testValkeyUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env['VALKEY_URL_TEST'];
  if (url) return url;
  const legacy = env['TEST_VALKEY_URL'];
  if (legacy) {
    if (!warned.has('TEST_VALKEY_URL')) {
      warned.add('TEST_VALKEY_URL');
      console.warn('[test] TEST_VALKEY_URL đã deprecated — dùng VALKEY_URL_TEST (T-022)');
    }
    return legacy;
  }
  return DEFAULT_VALKEY_URL_TEST;
}

/** `REQUIRE_INTEGRATION=1` (CI) ⇒ thiếu Postgres/Valkey là FAIL, không âm thầm bỏ qua. */
export function integrationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['REQUIRE_INTEGRATION'] === '1';
}
