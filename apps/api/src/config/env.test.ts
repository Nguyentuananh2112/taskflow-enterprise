import { describe, expect, it } from 'vitest';

import { productionEnvVars, testEnvVars } from '../../test/support';
import { appConfigFromEnv } from '../app';
import { DEFAULT_EXPORT_LIMITS, exportLimitsFromEnv } from '../core/export/export-limits';
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
    ['METRICS_PORT trùng PORT', { PORT: '4000', METRICS_PORT: '4000' }, 'METRICS_PORT'],
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

  it('T-057 LEAVE_CARRYOVER_ON_START / LEAVE_CARRYOVER_INTERVAL_MS: CHỈ APP_ENV=test; interval ≥ 1000', () => {
    const env = loadEnv(
      testEnvVars({
        APP_ENV: 'test',
        LEAVE_CARRYOVER_ON_START: 'true',
        LEAVE_CARRYOVER_INTERVAL_MS: '1000',
      }),
    );
    expect([env.LEAVE_CARRYOVER_ON_START, env.LEAVE_CARRYOVER_INTERVAL_MS]).toEqual([true, 1000]);
    expect(
      variablesOf(testEnvVars({ APP_ENV: 'test', LEAVE_CARRYOVER_INTERVAL_MS: '999' })),
    ).toEqual(['LEAVE_CARRYOVER_INTERVAL_MS']);
    for (const key of ['LEAVE_CARRYOVER_ON_START', 'LEAVE_CARRYOVER_INTERVAL_MS']) {
      const value = key.endsWith('MS') ? '5000' : 'true';
      expect(
        variablesOf(testEnvVars({ APP_ENV: 'local', NODE_ENV: 'development', [key]: value })),
        key,
      ).toEqual([key]);
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

  it('TEST_CLOCK_ANCHOR (E2E giờ nghiệp vụ): hợp lệ CHỈ khi APP_ENV=test, ISO có offset; thiếu / rỗng ⇒ undefined', () => {
    for (const anchor of [
      '2026-10-20T10:00:00+07:00',
      '2026-10-20T03:00:00Z',
      '2026-10-20T03:00:00.123Z',
    ]) {
      expect(
        loadEnv(testEnvVars({ APP_ENV: 'test', TEST_CLOCK_ANCHOR: anchor })).TEST_CLOCK_ANCHOR,
      ).toBe(anchor);
    }
    expect(loadEnv(testEnvVars()).TEST_CLOCK_ANCHOR).toBeUndefined();
    expect(loadEnv(testEnvVars({ TEST_CLOCK_ANCHOR: '  ' })).TEST_CLOCK_ANCHOR).toBeUndefined();
    for (const bad of ['2026-10-20', '2026-10-20T10:00:00', 'hôm nay', '1760929200000']) {
      expect(variablesOf(testEnvVars({ APP_ENV: 'test', TEST_CLOCK_ANCHOR: bad }))).toEqual([
        'TEST_CLOCK_ANCHOR',
      ]);
    }
  });

  it('T-049 job nhắc làm lương: PAYROLL_REMINDER_ON_START / _INTERVAL_MS hợp lệ CHỈ khi APP_ENV=test', () => {
    const env = loadEnv(
      testEnvVars({
        APP_ENV: 'test',
        PAYROLL_REMINDER_ON_START: 'true',
        PAYROLL_REMINDER_INTERVAL_MS: '2000',
      }),
    );
    expect([env.PAYROLL_REMINDER_ON_START, env.PAYROLL_REMINDER_INTERVAL_MS]).toEqual([true, 2000]);
    expect(
      variablesOf(testEnvVars({ APP_ENV: 'test', PAYROLL_REMINDER_INTERVAL_MS: '10' })),
    ).toEqual(['PAYROLL_REMINDER_INTERVAL_MS']);
    for (const key of ['PAYROLL_REMINDER_ON_START', 'PAYROLL_REMINDER_INTERVAL_MS']) {
      const value = key.endsWith('START') ? 'true' : '2000';
      expect(variablesOf(testEnvVars({ APP_ENV: 'local', [key]: value }))).toEqual([key]);
      expect(variablesOf(productionEnvVars({ [key]: value }))).toEqual([key]);
    }
  });

  it.each(['local', 'staging', 'production'])(
    'TEST_CLOCK_ANCHOR ở APP_ENV=%s ⇒ từ chối khởi động (không âm thầm bỏ qua)',
    (appEnv) => {
      const anchor = { APP_ENV: appEnv, TEST_CLOCK_ANCHOR: '2026-10-20T10:00:00+07:00' };
      const vars = appEnv === 'local' ? testEnvVars(anchor) : productionEnvVars(anchor);
      expect(variablesOf(vars)).toEqual(['TEST_CLOCK_ANCHOR']);
    },
  );

  const EXPORT_ENV = {
    EXPORT_MAX_EMPLOYEES: '3',
    EXPORT_MAX_LEAVE_ROWS: '5',
    EXPORT_BATCH_SIZE: '2',
    EXPORT_BATCH_DELAY_MS: '200',
  };

  it('T-055 EXPORT_* (F XL-05 / XL-07): APP_ENV=test ⇒ đọc được; thiếu / rỗng ⇒ mặc định của thiết kế; sai miền ⇒ 400', () => {
    const env = loadEnv(testEnvVars({ APP_ENV: 'test', ...EXPORT_ENV }));
    expect(exportLimitsFromEnv(env)).toEqual({
      maxEmployees: 3,
      maxLeaveRows: 5,
      batchSize: 2,
      batchDelayMs: 200,
    });
    expect(exportLimitsFromEnv(loadEnv(testEnvVars({ EXPORT_BATCH_SIZE: ' ' })))).toEqual(
      DEFAULT_EXPORT_LIMITS,
    );
    for (const [key, bad] of [
      ['EXPORT_MAX_EMPLOYEES', '0'],
      ['EXPORT_MAX_LEAVE_ROWS', '-1'],
      ['EXPORT_BATCH_SIZE', '1.5'],
      ['EXPORT_BATCH_DELAY_MS', '5001'],
    ] as const) {
      expect(variablesOf(testEnvVars({ APP_ENV: 'test', [key]: bad }))).toEqual([key]);
    }
  });

  it.each(['local', 'staging', 'production'])(
    'T-055 EXPORT_* ở APP_ENV=%s ⇒ từ chối khởi động, nêu đủ tên biến',
    (appEnv) => {
      const extra = { APP_ENV: appEnv, ...EXPORT_ENV };
      const vars = appEnv === 'local' ? testEnvVars(extra) : productionEnvVars(extra);
      expect([...variablesOf(vars)].sort()).toEqual(Object.keys(EXPORT_ENV).sort());
    },
  );

  it('T-035: thiếu SENTRY_DSN ở staging/production KHÔNG chặn khởi động (main.ts cảnh báo); rỗng = không đặt', () => {
    for (const appEnv of ['staging', 'production']) {
      expect(variablesOf(productionEnvVars({ APP_ENV: appEnv, SENTRY_DSN: undefined }))).toEqual(
        [],
      );
    }
    expect(loadEnv(testEnvVars({ SENTRY_DSN: '' })).SENTRY_DSN).toBeUndefined();
    expect(variablesOf(testEnvVars({ SENTRY_DSN: 'ftp://x@sentry.test/1' }))).toEqual([
      'SENTRY_DSN',
    ]);
  });

  it('F5: VALKEY_SOCKET_TIMEOUT_MS mặc định 3000; nhận số nguyên 500–30000; ngoài khoảng / không phải số ⇒ lỗi đúng tên biến', () => {
    expect(loadEnv(testEnvVars()).VALKEY_SOCKET_TIMEOUT_MS).toBe(3_000);
    for (const ok of ['500', '10000', '30000']) {
      expect(
        loadEnv({ ...testEnvVars(), VALKEY_SOCKET_TIMEOUT_MS: ok }).VALKEY_SOCKET_TIMEOUT_MS,
      ).toBe(Number(ok));
    }
    for (const bad of ['499', '30001', '1500.5', 'abc']) {
      expect(variablesOf({ ...testEnvVars(), VALKEY_SOCKET_TIMEOUT_MS: bad })).toEqual([
        'VALKEY_SOCKET_TIMEOUT_MS',
      ]);
    }
  });

  it('T-035: mặc định trace 0.05, metrics cổng 9464 trên 0.0.0.0; trace ngoài 0…1 ⇒ lỗi', () => {
    expect(loadEnv(testEnvVars({ METRICS_PORT: undefined }))).toMatchObject({
      SENTRY_TRACES_SAMPLE_RATE: 0.05,
      METRICS_PORT: 9464,
      METRICS_HOST: '127.0.0.1',
    });
    for (const bad of ['-0.1', '1.5', 'abc']) {
      expect(variablesOf(testEnvVars({ SENTRY_TRACES_SAMPLE_RATE: bad }))).toEqual([
        'SENTRY_TRACES_SAMPLE_RATE',
      ]);
    }
  });

  it.each(['staging', 'production'])(
    'review B (L3/L4): %s — SENTRY_DSN http ⇒ từ chối; METRICS_TOKEN bắt buộc (cả staging)',
    (appEnv) => {
      expect(
        variablesOf(productionEnvVars({ APP_ENV: appEnv, SENTRY_DSN: 'http://k@sentry.test/1' })),
      ).toEqual(['SENTRY_DSN']);
      expect(variablesOf(productionEnvVars({ APP_ENV: appEnv, METRICS_TOKEN: undefined }))).toEqual(
        ['METRICS_TOKEN'],
      );
    },
  );

  it('review B (L3): local/test vẫn nhận DSN http (Sentry tự host trên máy dev)', () => {
    expect(variablesOf(testEnvVars({ SENTRY_DSN: 'http://k@localhost:9000/1' }))).toEqual([]);
  });

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

describe('thời hạn lưu dữ liệu cá nhân (T-043, R27)', () => {
  it('mặc định = phương án B (ngày)', () => {
    expect(loadEnv(testEnvVars())).toMatchObject({
      RETENTION_CLIENT_INFO_DAYS: 395,
      RETENTION_LEAVE_REASON_DAYS: 395,
      RETENTION_RECORDS_DAYS: 730,
      RETENTION_NOTIFICATIONS_DAYS: 180,
      RETENTION_HR_AUDIT_DAYS: 1_826,
    });
  });

  it('dưới min (cấu hình nhầm, vd 0 ⇒ xóa sạch) ⇒ app không khởi động', () => {
    expect(
      variablesOf(
        testEnvVars({
          RETENTION_CLIENT_INFO_DAYS: '0',
          RETENTION_LEAVE_REASON_DAYS: '29',
          RETENTION_RECORDS_DAYS: '364',
          RETENTION_NOTIFICATIONS_DAYS: 'abc',
          RETENTION_HR_AUDIT_DAYS: '364',
        }),
      ),
    ).toEqual([
      'RETENTION_CLIENT_INFO_DAYS',
      'RETENTION_HR_AUDIT_DAYS',
      'RETENTION_LEAVE_REASON_DAYS',
      'RETENTION_NOTIFICATIONS_DAYS',
      'RETENTION_RECORDS_DAYS',
    ]);
  });
});
