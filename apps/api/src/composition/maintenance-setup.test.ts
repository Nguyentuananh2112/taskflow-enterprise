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

describe('maintenanceJobs — bật / tắt theo APP_ENV', () => {
  it.each(['local', 'test'] as const)(
    'APP_ENV=%s, không đặt cờ ⇒ KHÔNG có job nào (kể cả retention)',
    (appEnv) => {
      expect(
        names(
          testEnvVars({ APP_ENV: appEnv, NODE_ENV: appEnv === 'local' ? 'development' : 'test' }),
        ),
      ).toEqual([]);
    },
  );

  it('production ⇒ đủ 3 job, có retention', () => {
    expect(names(productionEnvVars())).toEqual([
      'purge-deleted-workspaces',
      'purge-expired-refresh-tokens',
      'retention',
    ]);
  });

  it('production đặt MAINTENANCE_JOBS_ENABLED=false ⇒ tắt hết', () => {
    expect(names(productionEnvVars({ MAINTENANCE_JOBS_ENABLED: 'false' }))).toEqual([]);
  });
});
