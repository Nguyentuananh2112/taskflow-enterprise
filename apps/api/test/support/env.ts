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
    ...overrides,
  });
}
