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
import { maintenanceJobs } from './maintenance-setup';
import type { Persistence } from './persistence';

const noop = () => Promise.resolve(0);
/** Lưu trữ kiểu Prisma (có đủ purger) — chỉ các trường `maintenanceJobs` đọc. */
const prismaLike = {
  uow: new FakeUnitOfWork(),
  workspace: { workspaces: {} },
  workspacePurger: {},
  refreshTokenPurger: { purgeExpired: noop },
  retention: {
    attendance: { scrubClientInfo: noop, deleteEvents: noop },
    leave: {
      scrubReasons: noop,
      deleteRequestsBeforeYear: noop,
      deleteBalancesBeforeYear: noop,
    },
    workspace: { deleteDepartures: noop, deleteHrAuditLogs: noop },
    notifications: { deleteNotifications: noop },
    tryLock: () => Promise.resolve(true),
  },
} as unknown as Persistence;

const names = (vars: NodeJS.ProcessEnv) =>
  maintenanceJobs({
    persistence: prismaLike,
    env: loadEnv(vars),
    clock: new FakeClock(),
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
