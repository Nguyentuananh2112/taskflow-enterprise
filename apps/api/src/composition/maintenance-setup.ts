import type { Env } from '../config/env';
import type { IClock } from '../core/domain';
import type { ILogger } from '../core/logging/logger';
import {
  maintenanceEnabled,
  purgeRefreshTokensJob,
  purgeWorkspacesJob,
  type ScheduledJob,
} from './maintenance-jobs';
import type { Persistence } from './persistence';
import { retentionJob, retentionPolicyFrom } from './retention-job';

/**
 * Danh sách job bảo trì của process API (ADR-095) — chỉ những job mà lưu trữ hiện tại hỗ trợ (bộ nhớ
 * không có purger). TẮT ⇒ `[]`: mặc định tắt ở APP_ENV local/test (localhost của người dùng có dữ liệu
 * thật — job retention XÓA dữ liệu), bật ở staging/production; `MAINTENANCE_JOBS_ENABLED` ghi đè.
 */
export function maintenanceJobs(d: {
  persistence: Persistence;
  env: Env;
  clock: IClock;
  logger: ILogger;
}): ScheduledJob[] {
  const { persistence: p, env, clock, logger } = d;
  if (!maintenanceEnabled(env.APP_ENV, env.MAINTENANCE_JOBS_ENABLED)) return [];
  const jobs: ScheduledJob[] = [];
  // T-033: purge workspace hết ân hạn mỗi giờ, khóa advisory theo lô.
  if (p.workspacePurger) {
    jobs.push(
      purgeWorkspacesJob({
        workspaces: p.workspace.workspaces,
        purger: p.workspacePurger,
        uow: p.uow,
        clock,
        logger,
        intervalMs: env.PURGE_INTERVAL_MS,
        jitterMs: env.PURGE_JITTER_MS,
      }),
    );
  }
  // G2 S2: dọn refresh token hết hạn mỗi ngày (security.md §2.2).
  if (p.refreshTokenPurger) {
    jobs.push(purgeRefreshTokensJob({ purger: p.refreshTokenPurger, uow: p.uow, clock, logger }));
  }
  // T-043 / R27: thời hạn lưu dữ liệu cá nhân Mốc 3 — mỗi ngày, khóa advisory theo lô.
  if (p.retention) {
    jobs.push(
      retentionJob({
        stores: p.retention,
        policy: retentionPolicyFrom(env),
        uow: p.uow,
        clock,
        logger,
      }),
    );
  }
  return jobs;
}
