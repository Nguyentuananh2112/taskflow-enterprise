import type { IClock } from '../core/domain';
import type { ILogger } from '../core/logging/logger';
import type { IUnitOfWork } from '../core/persistence/unit-of-work';
import type { ScheduledJob } from './maintenance-jobs';
import type { RetentionStores } from './retention-stores';

/**
 * Thời hạn lưu dữ liệu cá nhân Mốc 3 (R27, `data-retention.md` §3) — đơn vị NGÀY. Mặc định = phương án
 * B; đổi phương án ⇒ chỉ đổi mặc định ở `config/env.ts`.
 */
export interface RetentionPolicy {
  /** D1: IP / UA lượt chấm ⇒ NULL. */
  clientInfoDays: number;
  /** D3: lý do nghỉ ⇒ NULL (theo `end_date`, trừ đơn PENDING). */
  leaveReasonDays: number;
  /** D2 lượt chấm, D4 đơn + số dư (theo cả năm), D5 nhiệm kỳ đã kết thúc ⇒ xóa. */
  recordsDays: number;
  /** D6: thông báo ⇒ xóa. */
  notificationsDays: number;
  /** D7: HrAuditLog ⇒ xóa. */
  hrAuditDays: number;
}

/** Ngưỡng từ env đã validate (`config/env.ts` giữ mặc định + min). */
export function retentionPolicyFrom(env: {
  RETENTION_CLIENT_INFO_DAYS: number;
  RETENTION_LEAVE_REASON_DAYS: number;
  RETENTION_RECORDS_DAYS: number;
  RETENTION_NOTIFICATIONS_DAYS: number;
  RETENTION_HR_AUDIT_DAYS: number;
}): RetentionPolicy {
  return {
    clientInfoDays: env.RETENTION_CLIENT_INFO_DAYS,
    leaveReasonDays: env.RETENTION_LEAVE_REASON_DAYS,
    recordsDays: env.RETENTION_RECORDS_DAYS,
    notificationsDays: env.RETENTION_NOTIFICATIONS_DAYS,
    hrAuditDays: env.RETENTION_HR_AUDIT_DAYS,
  };
}

const DAY_MS = 86_400_000;
/** D16 (T-075, TL): sự kiện bằng chứng đồng ý quyền riêng tư giữ 5 năm kể từ `at` (như D7), không theo env. */
export const PRIVACY_CONSENT_RETENTION_DAYS = 5 * 365 + 1;
export const RETENTION_BATCH = 1_000;
/** Trần số lô mỗi lượt (≤ 200k dòng) — phần còn lại để lượt sau (ngày mai). */
export const RETENTION_MAX_BATCHES = 200;
export const RETENTION_INTERVAL_MS = DAY_MS;
export const RETENTION_JITTER_MS = 30 * 60 * 1000;
/** Lệch khỏi purge workspace (30 s) và dọn refresh token (90 s) sau khởi động. */
export const RETENTION_FIRST_RUN_AFTER_MS = 150_000;

type Step = { name: string; run: (limit: number) => Promise<number> };

const dateOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Mốc lưu của dữ liệu công / đơn (D2, D4, D5) — NGUỒN DUY NHẤT cho job và cho API (`OUTSIDE_RETENTION`, việc
 * nối tiếp T-043 của A): ngày công `< cutoffDate` đã / sẽ bị job xóa; đơn + số dư của năm `< cutoffYear` cũng vậy.
 */
export function recordsRetentionCutoff(
  policy: Pick<RetentionPolicy, 'recordsDays'>,
  now: Date,
): { cutoffDate: string; cutoffYear: number } {
  const at = new Date(now.getTime() - policy.recordsDays * DAY_MS);
  return { cutoffDate: dateOf(at), cutoffYear: at.getUTCFullYear() };
}

/** Các bước theo thứ tự: XÓA trước (bớt dòng phải scrub), scrub sau. Mốc tính từ `now` của lượt. */
export function retentionSteps(s: RetentionStores, p: RetentionPolicy, now: Date): Step[] {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  // năm Y xóa khi 31/12/Y < mốc ⇔ Y < năm của mốc
  const { cutoffDate: recordsDate, cutoffYear: recordsYear } = recordsRetentionCutoff(p, now);
  const reasonDate = dateOf(before(p.leaveReasonDays));
  return [
    // D9 TRƯỚC D2: đơn APPROVED trỏ tới lượt ADJUSTMENT cùng ngày (`created_event_id`, FK NO ACTION).
    {
      name: 'attendance_corrections',
      run: (n) => s.attendance.deleteCorrections(recordsDate, n),
    },
    { name: 'attendance_events', run: (n) => s.attendance.deleteEvents(recordsDate, n) },
    { name: 'leave_requests', run: (n) => s.leave.deleteRequestsBeforeYear(recordsYear, n) },
    { name: 'leave_balances', run: (n) => s.leave.deleteBalancesBeforeYear(recordsYear, n) },
    // D8 TRƯỚC D5: căn cứ giữ hồ sơ là departure có `last_day ≥ mốc D5` (D5 xóa departure đó).
    { name: 'employee_profiles', run: (n) => s.hrProfile.deleteProfiles(recordsDate, n) },
    { name: 'member_departures', run: (n) => s.company.deleteDepartures(recordsDate, n) },
    {
      name: 'notifications',
      run: (n) => s.notifications.deleteNotifications(before(p.notificationsDays), n),
    },
    { name: 'hr_audit_logs', run: (n) => s.company.deleteHrAuditLogs(before(p.hrAuditDays), n) },
    {
      name: 'privacy_consent_events',
      run: (n) => s.privacy.purgeEventsBefore(before(PRIVACY_CONSENT_RETENTION_DAYS), n),
    },
    {
      name: 'attendance_client_info',
      run: (n) => s.attendance.scrubClientInfo(before(p.clientInfoDays), n),
    },
    { name: 'leave_reasons', run: (n) => s.leave.scrubReasons(reasonDate, n) },
    {
      name: 'correction_reasons',
      run: (n) => s.attendance.scrubCorrectionReasons(reasonDate, n),
    },
    {
      name: 'hr_audit_notes',
      run: (n) => s.company.scrubHrAuditNotes(before(p.leaveReasonDays), n),
    },
  ];
}

export interface RetentionResult {
  /** Số dòng đã xóa / scrub theo bước — chỉ số đếm, không id / nội dung. */
  rows: Record<string, number>;
  batches: number;
  busy: boolean;
  /** Mọi bước đã hết dòng quá hạn trong lượt này. */
  complete: boolean;
}

/**
 * Job retention (T-043): mỗi lô một transaction, câu đầu lấy khóa advisory; không lấy được ⇒ `busy`,
 * dừng lượt. Mỗi bước chạy tới khi lô < `batchSize`. Idempotent; `signal` hủy ⇒ dừng TRƯỚC lô kế.
 */
export class RetentionJob {
  constructor(
    private readonly d: {
      stores: RetentionStores;
      policy: RetentionPolicy;
      uow: IUnitOfWork;
      clock: IClock;
    },
  ) {}

  async execute(
    input: { batchSize?: number; maxBatches?: number; signal?: AbortSignal } = {},
  ): Promise<RetentionResult> {
    const batchSize = input.batchSize ?? RETENTION_BATCH;
    const maxBatches = input.maxBatches ?? RETENTION_MAX_BATCHES;
    const result: RetentionResult = { rows: {}, batches: 0, busy: false, complete: false };
    const { stores } = this.d;
    for (const step of retentionSteps(stores, this.d.policy, this.d.clock.now())) {
      let rows = 0;
      result.rows[step.name] = 0;
      for (;;) {
        if (input.signal?.aborted || result.batches >= maxBatches) return result;
        const changed = await this.d.uow.run(async () =>
          (await stores.tryLock()) ? step.run(batchSize) : null,
        );
        if (changed === null) {
          result.busy = true;
          return result;
        }
        result.batches += 1;
        rows += changed;
        result.rows[step.name] = rows;
        if (changed < batchSize) break;
      }
    }
    result.complete = true;
    return result;
  }
}

export function retentionJob(d: {
  stores: RetentionStores;
  policy: RetentionPolicy;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}): ScheduledJob {
  const job = new RetentionJob(d);
  return {
    name: 'retention',
    intervalMs: RETENTION_INTERVAL_MS,
    jitterMs: RETENTION_JITTER_MS,
    firstRunAfterMs: RETENTION_FIRST_RUN_AFTER_MS,
    async run(signal) {
      if (signal?.aborted) return;
      const { rows, batches, busy, complete } = await job.execute(signal ? { signal } : {});
      const aborted = signal?.aborted ?? false;
      d.logger.info({ rows, batches, busy, complete, aborted }, 'maintenance.retention_summary');
    },
  };
}
