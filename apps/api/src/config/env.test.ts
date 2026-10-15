import { describe, expect, it } from 'vitest';

import { productionEnvVars, testEnvVars } from '../../test/support';
import { appConfigFromEnv } from '../app';
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
  ])('%s', (_label, overrides, variable) => {
    expect(variablesOf(productionEnvVars(overrides))).toEqual([variable]);
  });

  it('T-020: mặc định PERSISTENCE = prisma; memory được phép ở local/test', () => {
    expect(loadEnv(testEnvVars())).toMatchObject({ PERSISTENCE: 'prisma' });
    expect(variablesOf(testEnvVars({ PERSISTENCE: 'memory' }))).toEqual([]);
  });

  it('T-024: không còn biến PERSISTENCE_TASK (Task theo PERSISTENCE) — giá trị cũ bị bỏ qua', () => {
    expect(loadEnv(testEnvVars({ PERSISTENCE_TASK: 'memory' }))).not.toHaveProperty(
      'PERSISTENCE_TASK',
    );
  });

  it('T-020: APP_ENV=staging với NODE_ENV khác production vẫn cấm lưu trữ bộ nhớ', () => {
    expect(variablesOf(testEnvVars({ APP_ENV: 'staging', PERSISTENCE: 'memory' }))).toContain(
      'PERSISTENCE',
    );
  });

  it.each(['staging', 'production'])(
    'L1 (T-031): APP_ENV=%s mà NODE_ENV≠production ⇒ MỌI ràng buộc production vẫn áp (không còn dựa NODE_ENV)',
    (appEnv) => {
      expect(variablesOf(testEnvVars({ APP_ENV: appEnv, NODE_ENV: 'development' }))).toEqual([
        'COOKIE_SECURE',
        'CORS_ORIGINS',
        'JWT_ACCESS_SECRET',
        'METRICS_TOKEN',
        'NODE_ENV',
        'REDIS_URL',
        'SENTRY_DSN',
      ]);
      expect(variablesOf(productionEnvVars({ APP_ENV: appEnv, NODE_ENV: 'development' }))).toEqual([
        'NODE_ENV',
      ]);
    },
  );

  it.each([[''], ['  '], [undefined], ['-1'], ['11'], ['1.5']])(
    'L1 (T-031): TRUST_PROXY_HOPS=%j ⇒ lỗi (bắt buộc tường minh, 0…10 — rỗng KHÔNG thành 0)',
    (value) => {
      expect(variablesOf(testEnvVars({ TRUST_PROXY_HOPS: value }))).toEqual(['TRUST_PROXY_HOPS']);
    },
  );

  it('JWT_ACCESS_TTL_SECONDS (E2E-11): hợp lệ CHỈ khi APP_ENV=test, 5–900; thiếu ⇒ undefined (900)', () => {
    expect(loadEnv(testEnvVars({ APP_ENV: 'test', JWT_ACCESS_TTL_SECONDS: '5' }))).toMatchObject({
      JWT_ACCESS_TTL_SECONDS: 5,
    });
    expect(loadEnv(testEnvVars()).JWT_ACCESS_TTL_SECONDS).toBeUndefined();
    expect(
      loadEnv(testEnvVars({ JWT_ACCESS_TTL_SECONDS: '' })).JWT_ACCESS_TTL_SECONDS,
    ).toBeUndefined();
    for (const bad of ['4', '901', '1.5', 'abc']) {
      expect(variablesOf(testEnvVars({ APP_ENV: 'test', JWT_ACCESS_TTL_SECONDS: bad }))).toEqual([
        'JWT_ACCESS_TTL_SECONDS',
      ]);
    }
  });

  it.each(['local', 'staging', 'production'])(
    'JWT_ACCESS_TTL_SECONDS ở APP_ENV=%s ⇒ từ chối khởi động (không âm thầm bỏ qua)',
    (appEnv) => {
      const vars =
        appEnv === 'local'
          ? testEnvVars({ APP_ENV: appEnv, JWT_ACCESS_TTL_SECONDS: '60' })
          : productionEnvVars({ APP_ENV: appEnv, JWT_ACCESS_TTL_SECONDS: '60' });
      expect(variablesOf(vars)).toEqual(['JWT_ACCESS_TTL_SECONDS']);
    },
  );

  it('appConfigFromEnv: production / hsts theo APP_ENV, không theo NODE_ENV', () => {
    const local = appConfigFromEnv(loadEnv(testEnvVars({ APP_ENV: 'local', NODE_ENV: 'test' })));
    expect([local.production, local.hsts]).toEqual([false, false]);
    const prod = appConfigFromEnv(loadEnv(productionEnvVars()));
    expect([prod.production, prod.hsts]).toEqual([true, true]);
  });

  it('ràng buộc production không áp cho development', () => {
    expect(variablesOf(testEnvVars({ NODE_ENV: 'development', APP_ENV: 'local' }))).toEqual([]);
  });
});

describe('job bảo trì (T-033)', () => {
  it('mặc định: không đặt MAINTENANCE_JOBS_ENABLED (composition tính theo APP_ENV), chu kỳ 1 giờ + jitter 5 phút', () => {
    expect(loadEnv(testEnvVars())).toMatchObject({
      PURGE_INTERVAL_MS: 3_600_000,
      PURGE_JITTER_MS: 300_000,
    });
    expect(loadEnv(testEnvVars()).MAINTENANCE_JOBS_ENABLED).toBeUndefined();
    expect(
      loadEnv(testEnvVars({ MAINTENANCE_JOBS_ENABLED: 'false' })).MAINTENANCE_JOBS_ENABLED,
    ).toBe(false);
  });

  it('chu kỳ quá ngắn (< 1 phút) bị từ chối', () => {
    expect(variablesOf(testEnvVars({ PURGE_INTERVAL_MS: '1000' }))).toEqual(['PURGE_INTERVAL_MS']);
  });
});
