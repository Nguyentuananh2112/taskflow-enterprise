// T-043: job bảo trì (gồm retention — XÓA dữ liệu cá nhân) chỉ chạy mặc định ở staging/production.
// Localhost của người dùng chạy APP_ENV=local với dữ liệu thật ⇒ không được có job nào.
import { describe, expect, it } from 'vitest';

import {
  FakeClock,
  FakeUnitOfWork,
  SpyLogger,
  productionEnvVars,
  testEnvVars,
} from '../../test/support';
import { loadEnv } from '../config/env';
import {
  isRetentionActive,
  LEAVE_CARRYOVER_JOB,
  maintenanceJobs,
  retentionCutoffFor,
} from './maintenance-setup';
import { recordsRetentionCutoff } from './retention-job';
import type { Persistence } from './persistence';

const noop = () => Promise.resolve(0);
/** Lưu trữ kiểu Prisma (có đủ purger) — chỉ các trường `maintenanceJobs` đọc. */
const prismaLike = {
  uow: new FakeUnitOfWork(),
  workspace: { workspaces: {} },
  workspacePurger: {},
  refreshTokenPurger: { purgeExpired: noop },
  retention: {
    attendance: {
      scrubClientInfo: noop,
      deleteEvents: noop,
      deleteCorrections: noop,
      scrubCorrectionReasons: noop,
    },
    leave: {
      scrubReasons: noop,
      deleteRequestsBeforeYear: noop,
      deleteBalancesBeforeYear: noop,
    },
    company: { deleteDepartures: noop, deleteHrAuditLogs: noop, scrubHrAuditNotes: noop },
    notifications: { deleteNotifications: noop },
    hrProfile: { deleteProfiles: noop },
    tryLock: () => Promise.resolve(true),
  },
} as unknown as Persistence;

const names = (vars: NodeJS.ProcessEnv) =>
  maintenanceJobs({
    persistence: prismaLike,
    env: loadEnv(vars),
    clock: new FakeClock(),
    businessClock: new FakeClock(),
    logger: new SpyLogger(),
  }).map((j) => j.name);

describe('maintenanceJobs — bật / tắt theo APP_ENV và cờ', () => {
  const local = (extra: NodeJS.ProcessEnv = {}) =>
    testEnvVars({ APP_ENV: 'local', NODE_ENV: 'development', ...extra });

  it.each(['local', 'test'] as const)('APP_ENV=%s, không đặt cờ ⇒ KHÔNG có job nào', (appEnv) => {
    const nodeEnv = appEnv === 'local' ? 'development' : 'test';
    expect(names(testEnvVars({ APP_ENV: appEnv, NODE_ENV: nodeEnv }))).toEqual([]);
  });

  it('local + chỉ cờ chung MAINTENANCE_JOBS_ENABLED=true ⇒ có purge, KHÔNG có retention', () => {
    expect(names(local({ MAINTENANCE_JOBS_ENABLED: 'true' }))).toEqual([
      'purge-deleted-workspaces',
      'purge-expired-refresh-tokens',
    ]);
  });

  it('local + RETENTION_JOB_ENABLED=true (bật có chủ đích) ⇒ chỉ retention', () => {
    expect(names(local({ RETENTION_JOB_ENABLED: 'true' }))).toEqual(['retention']);
  });

  it('production mặc định ⇒ đủ 3 job, có retention', () => {
    expect(names(productionEnvVars())).toEqual([
      'purge-deleted-workspaces',
      'purge-expired-refresh-tokens',
      'retention',
    ]);
  });

  it('production RETENTION_JOB_ENABLED=false ⇒ tắt riêng retention', () => {
    expect(names(productionEnvVars({ RETENTION_JOB_ENABLED: 'false' }))).toEqual([
      'purge-deleted-workspaces',
      'purge-expired-refresh-tokens',
    ]);
  });

  it('production MAINTENANCE_JOBS_ENABLED=false ⇒ tắt hết (retention theo cờ chung khi không đặt cờ riêng)', () => {
    expect(names(productionEnvVars({ MAINTENANCE_JOBS_ENABLED: 'false' }))).toEqual([]);
  });
});

describe('maintenanceJobs — đồng hồ của từng job (R31)', () => {
  it('purge workspace + retention tính mốc theo giờ NGHIỆP VỤ; dọn refresh token theo giờ THẬT', async () => {
    const seen: Record<string, unknown> = {};
    const record = (key: string) => (arg: unknown) => {
      seen[key] = arg;
      return Promise.resolve(0);
    };
    const persistence = {
      uow: new FakeUnitOfWork(),
      workspace: {
        workspaces: { listPurgeable: (now: Date) => record('purgeNow')(now).then(() => []) },
      },
      workspacePurger: {},
      refreshTokenPurger: { purgeExpired: record('tokenCutoff') },
      retention: {
        ...(prismaLike.retention as object),
        attendance: {
          scrubClientInfo: noop,
          deleteEvents: record('eventsCutoff'),
          deleteCorrections: noop,
          scrubCorrectionReasons: noop,
        },
      },
    } as unknown as Persistence;
    const real = new FakeClock('2026-12-01T00:00:00.000Z');
    const business = new FakeClock('2030-06-15T00:00:00.000Z');
    const jobs = maintenanceJobs({
      persistence,
      env: loadEnv(productionEnvVars()),
      clock: real,
      businessClock: business,
      logger: new SpyLogger(),
    });
    for (const job of jobs) await job.run();
    expect(seen.purgeNow).toEqual(business.now());
    expect(seen.eventsCutoff).toBe('2028-06-15'); // 2030-06-15 − 730 ngày (29/02/2028 nằm trước tháng 6)
    expect((seen.tokenCutoff as Date).getTime()).toBe(real.now().getTime() - 7 * 86_400_000);
  });

  it('recordsRetentionCutoff: nguồn mốc chung cho job và API (OUTSIDE_RETENTION)', () => {
    expect(recordsRetentionCutoff({ recordsDays: 730 }, new Date('2026-12-01T00:00:00Z'))).toEqual({
      cutoffDate: '2024-12-01',
      cutoffYear: 2024,
    });
  });
});

describe('isRetentionActive / retentionCutoffFor (T-047 — mốc OUTSIDE_RETENTION của API)', () => {
  const local = (extra: NodeJS.ProcessEnv = {}) =>
    loadEnv(testEnvVars({ APP_ENV: 'local', NODE_ENV: 'development', ...extra }));
  const memoryLike: Pick<Persistence, 'retention'> = {};

  it('CÙNG điều kiện với job: job tắt (cờ local mặc định / không có bước dọn) ⇒ không áp (null)', () => {
    expect(isRetentionActive(local(), prismaLike)).toBe(false);
    expect(isRetentionActive(local({ RETENTION_JOB_ENABLED: 'true' }), memoryLike)).toBe(false);
    expect(isRetentionActive(local({ RETENTION_JOB_ENABLED: 'true' }), prismaLike)).toBe(true);
    expect(names(testEnvVars({ APP_ENV: 'local', NODE_ENV: 'development' }))).not.toContain(
      'retention',
    );
    const off = retentionCutoffFor({
      env: local(),
      persistence: prismaLike,
      businessClock: new FakeClock(),
    });
    expect(off()).toBeNull();
  });

  it('job bật ⇒ mốc = recordsRetentionCutoff(policy, GIỜ NGHIỆP VỤ) — trôi theo đồng hồ, đúng số ngày của policy', () => {
    const business = new FakeClock('2026-11-17T03:00:00.000Z');
    const env = local({ RETENTION_JOB_ENABLED: 'true', RETENTION_RECORDS_DAYS: '400' });
    const cutoff = retentionCutoffFor({ env, persistence: prismaLike, businessClock: business });
    expect(cutoff()).toBe('2025-10-13');
    expect(cutoff()).toBe(recordsRetentionCutoff({ recordsDays: 400 }, business.now()).cutoffDate);
    business.advance(24 * 3600_000);
    expect(cutoff()).toBe('2025-10-14');
  });
});

describe('T-057: job leave-carryover', () => {
  const jobs = (vars: NodeJS.ProcessEnv) =>
    maintenanceJobs({
      persistence: prismaLike,
      env: loadEnv(vars),
      clock: new FakeClock(),
      businessClock: new FakeClock(),
      logger: new SpyLogger(),
      carryover: { runOnce: noop },
    });

  it('LUÔN đăng ký (kể cả local/test không cờ — luật nghiệp vụ): 1 giờ + jitter 5 phút, lượt đầu sau 5 s', () => {
    const job = jobs(testEnvVars({ APP_ENV: 'test' })).find((j) => j.name === LEAVE_CARRYOVER_JOB);
    expect(job).toMatchObject({ intervalMs: 3_600_000, jitterMs: 300_000, firstRunAfterMs: 5_000 });
  });

  it('LEAVE_CARRYOVER_INTERVAL_MS (test) ⇒ đúng interval, không jitter', () => {
    const job = jobs(testEnvVars({ APP_ENV: 'test', LEAVE_CARRYOVER_INTERVAL_MS: '2000' })).find(
      (j) => j.name === LEAVE_CARRYOVER_JOB,
    );
    expect(job).toMatchObject({ intervalMs: 2_000, jitterMs: 0 });
  });
});
