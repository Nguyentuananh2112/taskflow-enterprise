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
import { recordsRetentionCutoff, retentionJob, retentionPolicyFrom } from './retention-job';

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
  /**
   * T-062 (R40): hoàn tất nghỉ việc tới hạn — LUÔN chạy (kể cả local/test): đây là luật nghiệp vụ (rời ws, thu hồi
   * phiên, dọn đơn), không phải dọn dẹp. Thiếu ⇒ không đăng ký (test cũ).
   */
  offboarding?: { completeDueOffboardings(signal?: AbortSignal): Promise<unknown> };
  /** T-049: nhắc làm lương — LUÔN chạy (luật nghiệp vụ, như hoàn tất nghỉ việc). Thiếu ⇒ không đăng ký. */
  payroll?: { remindIfDue(): Promise<unknown> };
}): ScheduledJob[] {
  const { persistence: p, env, clock, businessClock, logger } = d;
  const groupOn = maintenanceEnabled(env.APP_ENV, env.MAINTENANCE_JOBS_ENABLED);
  const jobs: ScheduledJob[] = [];
  const offboarding = d.offboarding;
  if (offboarding) {
    jobs.push({
      name: 'complete-offboardings',
      intervalMs: OFFBOARDING_INTERVAL_MS,
      jitterMs: 5_000,
      firstRunAfterMs: 5_000,
      run: async (signal) => {
        await offboarding.completeDueOffboardings(signal);
      },
    });
  }
  const payroll = d.payroll;
  if (payroll) {
    jobs.push({
      name: 'payroll-reminder',
      intervalMs: env.PAYROLL_REMINDER_INTERVAL_MS ?? PAYROLL_REMINDER_INTERVAL_MS,
      jitterMs: env.PAYROLL_REMINDER_INTERVAL_MS === undefined ? 60_000 : 0,
      firstRunAfterMs: env.PAYROLL_REMINDER_ON_START ? 0 : 60_000,
      run: async () => {
        await payroll.remindIfDue();
      },
    });
  }
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
  if (p.retention && isRetentionActive(env, p)) {
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

/** Nhắc làm lương: chạy mỗi giờ; chống lặp theo (kỳ, ngày) ⇒ mỗi ngày tối đa một nhắc. */
export const PAYROLL_REMINDER_INTERVAL_MS = 3_600_000;

/** R40: socket đã nối của người hết `access_until` bị ngắt trễ tối đa ~1 phút. */
export const OFFBOARDING_INTERVAL_MS = 60_000;

/**
 * Job retention THẬT SỰ chạy ở process này: lưu trữ có bước dọn (Prisma) VÀ cờ cho phép. Một điều kiện duy nhất cho
 * cả `maintenanceJobs` lẫn mốc API (T-047, TL d9) — job tắt thì dữ liệu cũ còn nguyên, API không được che / chặn.
 */
export function isRetentionActive(
  env: Pick<Env, 'APP_ENV' | 'MAINTENANCE_JOBS_ENABLED' | 'RETENTION_JOB_ENABLED'>,
  persistence: Pick<Persistence, 'retention'>,
): boolean {
  return persistence.retention !== undefined && retentionEnabled(env);
}

/**
 * Mốc lưu dữ liệu chấm công cho API (T-047): CHÍNH hàm mốc của job (`recordsRetentionCutoff`, theo giờ NGHIỆP VỤ như
 * job — R31) ⇒ API không lệch job. Job không chạy ⇒ luôn `null`.
 */
export function retentionCutoffFor(d: {
  env: Env;
  persistence: Pick<Persistence, 'retention'>;
  businessClock: IClock;
}): () => string | null {
  if (!isRetentionActive(d.env, d.persistence)) return () => null;
  const policy = retentionPolicyFrom(d.env);
  return () => recordsRetentionCutoff(policy, d.businessClock.now()).cutoffDate;
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
