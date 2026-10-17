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
 * không có purger). Job purge / dọn token: mặc định tắt ở APP_ENV local/test, bật ở staging/production;
 * `MAINTENANCE_JOBS_ENABLED` ghi đè. Retention có cờ riêng — xem `retentionEnabled`.
 */
export function maintenanceJobs(d: {
  persistence: Persistence;
  env: Env;
  /** Giờ thật — dọn refresh token (hạn token do auth ghi theo giờ thật). */
  clock: IClock;
  /**
   * Giờ NGHIỆP VỤ (= `clock` ngoài E2E; `TEST_CLOCK_ANCHOR` chỉ APP_ENV=test) — purge workspace + retention:
   * so mốc với `purgeAt` / `work_date` / `created_at`… mà các module nghiệp vụ ghi theo đồng hồ này (review B, T-038).
   */
  businessClock: IClock;
  logger: ILogger;
}): ScheduledJob[] {
  const { persistence: p, env, clock, businessClock, logger } = d;
  const groupOn = maintenanceEnabled(env.APP_ENV, env.MAINTENANCE_JOBS_ENABLED);
  const jobs: ScheduledJob[] = [];
  // T-033: purge workspace hết ân hạn mỗi giờ, khóa advisory theo lô.
  if (groupOn && p.workspacePurger) {
    jobs.push(
      purgeWorkspacesJob({
        workspaces: p.workspace.workspaces,
        purger: p.workspacePurger,
        uow: p.uow,
        clock: businessClock,
        logger,
        intervalMs: env.PURGE_INTERVAL_MS,
        jitterMs: env.PURGE_JITTER_MS,
      }),
    );
  }
  // G2 S2: dọn refresh token hết hạn mỗi ngày (security.md §2.2).
  if (groupOn && p.refreshTokenPurger) {
    jobs.push(purgeRefreshTokensJob({ purger: p.refreshTokenPurger, uow: p.uow, clock, logger }));
  }
  // T-043 / R27: thời hạn lưu dữ liệu cá nhân Mốc 3 — mỗi ngày, khóa advisory theo lô.
  if (p.retention && retentionEnabled(env)) {
    jobs.push(
      retentionJob({
        stores: p.retention,
        policy: retentionPolicyFrom(env),
        uow: p.uow,
        clock: businessClock,
        logger,
      }),
    );
  }
  return jobs;
}

/**
 * Retention XÓA VĨNH VIỄN dữ liệu ⇒ phải bật có chủ đích. local/test (localhost của người dùng có dữ liệu
 * thật): CHỈ khi `RETENTION_JOB_ENABLED=true` — cờ chung `MAINTENANCE_JOBS_ENABLED` không đủ.
 * staging/production: cờ riêng nếu đặt, không thì theo cờ chung, mặc định bật.
 */
export function retentionEnabled(
  env: Pick<Env, 'APP_ENV' | 'MAINTENANCE_JOBS_ENABLED' | 'RETENTION_JOB_ENABLED'>,
): boolean {
  if (env.APP_ENV === 'local' || env.APP_ENV === 'test') return env.RETENTION_JOB_ENABLED === true;
  return env.RETENTION_JOB_ENABLED ?? env.MAINTENANCE_JOBS_ENABLED ?? true;
}
