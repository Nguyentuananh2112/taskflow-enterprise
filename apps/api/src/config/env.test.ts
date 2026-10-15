import { describe, expect, it } from 'vitest';

import { productionEnvVars, testEnvVars } from '../../test/support';
import { EnvValidationError, loadEnv } from './env';

const variablesOf = (source: NodeJS.ProcessEnv): readonly string[] => {
  try {
    loadEnv(source);
  } catch (err) {
    if (err instanceof EnvValidationError) return err.variables;
    throw err;
  }
  return [];
};

describe('loadEnv — hợp lệ', () => {
  it('parse + áp mặc định (PORT, pool, log, shutdown) và chuyển kiểu', () => {
    const env = loadEnv(testEnvVars());
    expect(env).toMatchObject({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_POOL_MAX: 10,
      LOG_LEVEL: 'info',
      COOKIE_SECURE: false,
      TRUST_PROXY_HOPS: 0,
      SOCKET_REDIS_ADAPTER: false,
      SHUTDOWN_TIMEOUT_MS: 20_000,
      READINESS_DRAIN_MS: 5_000,
      CORS_ORIGINS: ['http://localhost:3001'],
    });
  });

  it('CORS_ORIGINS nhiều giá trị, bỏ khoảng trắng và phần rỗng', () => {
    const env = loadEnv(testEnvVars({ CORS_ORIGINS: ' http://a.test:3000 , https://b.test,' }));
    expect(env.CORS_ORIGINS).toEqual(['http://a.test:3000', 'https://b.test']);
  });

  it('thiếu CORS_ORIGINS ngoài production ⇒ mặc định web local :3001 (ADR-097)', () => {
    expect(loadEnv(testEnvVars({ CORS_ORIGINS: undefined })).CORS_ORIGINS).toEqual([
      'http://localhost:3001',
    ]);
  });

  it('bộ biến production hợp lệ được chấp nhận', () => {
    expect(loadEnv(productionEnvVars()).NODE_ENV).toBe('production');
  });
});

describe('loadEnv — từ chối (chỉ báo TÊN biến, không báo giá trị)', () => {
  it.each([
    [
      'thiếu biến bắt buộc',
      { DATABASE_URL: undefined, JWT_ACCESS_SECRET: undefined },
      ['DATABASE_URL', 'JWT_ACCESS_SECRET'],
    ],
    ['DATABASE_URL không phải postgres', { DATABASE_URL: 'mysql://x@h/db' }, ['DATABASE_URL']],
    ['REDIS_URL sai giao thức', { REDIS_URL: 'http://h:6379' }, ['REDIS_URL']],
    ['JWT secret < 32 byte', { JWT_ACCESS_SECRET: 'short' }, ['JWT_ACCESS_SECRET']],
    [
      'PREVIOUS trùng secret hiện tại',
      { JWT_ACCESS_SECRET_PREVIOUS: 'test-only-jwt-secret-0123456789abcdef' },
      ['JWT_ACCESS_SECRET_PREVIOUS'],
    ],
    ['CORS có path', { CORS_ORIGINS: 'http://localhost:3000/app' }, ['CORS_ORIGINS']],
    ['CORS rỗng', { CORS_ORIGINS: ' , ' }, ['CORS_ORIGINS']],
    ['COOKIE_SECURE không phải boolean', { COOKIE_SECURE: 'maybe' }, ['COOKIE_SECURE']],
    ['pool ngoài 1–50', { DATABASE_POOL_MAX: '51' }, ['DATABASE_POOL_MAX']],
    ['NODE_ENV lạ', { NODE_ENV: 'staging' }, ['NODE_ENV']],
  ])('%s', (_label, overrides, expected) => {
    expect(variablesOf(testEnvVars(overrides))).toEqual(expected);
  });

  it('message lỗi không chứa giá trị secret', () => {
    const secret = 'hunter2-is-not-long-enough';
    try {
      loadEnv(testEnvVars({ JWT_ACCESS_SECRET: secret }));
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain(secret);
    }
  });
});

describe('loadEnv — ràng buộc production (devops.md §2.4, security.md §6.9)', () => {
  it.each([
    ['COOKIE_SECURE=false ⇒ từ chối khởi động', { COOKIE_SECURE: 'false' }, 'COOKIE_SECURE'],
    ['Valkey không TLS', { REDIS_URL: 'redis://valkey:6379' }, 'REDIS_URL'],
    [
      'thiếu CORS_ORIGINS (mặc định http local bị chặn)',
      { CORS_ORIGINS: undefined },
      'CORS_ORIGINS',
    ],
    [
      'CORS http://',
      { CORS_ORIGINS: 'https://a.example.com,http://b.example.com' },
      'CORS_ORIGINS',
    ],
    [
      'secret placeholder',
      { JWT_ACCESS_SECRET: 'change-me-min-32-bytes-xxxxxxxxxxxx' },
      'JWT_ACCESS_SECRET',
    ],
    [
      'secret test-only',
      { JWT_ACCESS_SECRET: 'test-only-jwt-secret-0123456789abcdef' },
      'JWT_ACCESS_SECRET',
    ],
    [
      'secret PREVIOUS test-only',
      { JWT_ACCESS_SECRET_PREVIOUS: 'test-only-previous-0123456789abcdefgh' },
      'JWT_ACCESS_SECRET_PREVIOUS',
    ],
    ['APP_ENV local với NODE_ENV production', { APP_ENV: 'local' }, 'APP_ENV'],
    ['thiếu SENTRY_DSN', { SENTRY_DSN: undefined }, 'SENTRY_DSN'],
    ['thiếu METRICS_TOKEN', { METRICS_TOKEN: undefined }, 'METRICS_TOKEN'],
    ['T-020: lưu trữ bộ nhớ ở staging/production', { PERSISTENCE: 'memory' }, 'PERSISTENCE'],
    [
      'T-020: module Task chạy bộ nhớ ở staging/production',
      { PERSISTENCE_TASK: 'memory' },
      'PERSISTENCE_TASK',
    ],
  ])('%s', (_label, overrides, variable) => {
    expect(variablesOf(productionEnvVars(overrides))).toEqual([variable]);
  });

  it('T-020: mặc định PERSISTENCE / PERSISTENCE_TASK = prisma; memory được phép ở local/test', () => {
    expect(loadEnv(testEnvVars())).toMatchObject({
      PERSISTENCE: 'prisma',
      PERSISTENCE_TASK: 'prisma',
    });
    expect(variablesOf(testEnvVars({ PERSISTENCE: 'memory', PERSISTENCE_TASK: 'memory' }))).toEqual(
      [],
    );
  });

  it('T-020: APP_ENV=staging với NODE_ENV khác production vẫn cấm lưu trữ bộ nhớ', () => {
    expect(variablesOf(testEnvVars({ APP_ENV: 'staging', PERSISTENCE: 'memory' }))).toEqual([
      'PERSISTENCE',
    ]);
  });

  it('ràng buộc production không áp cho development', () => {
    expect(variablesOf(testEnvVars({ NODE_ENV: 'development', APP_ENV: 'local' }))).toEqual([]);
  });
});
