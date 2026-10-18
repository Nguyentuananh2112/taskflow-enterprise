import type { IClock } from '../core/domain';
import type { ILogger } from '../core/logging/logger';
import { dbSqlStateOf } from '../core/persistence/transient-db-error';
import type { IUnitOfWork } from '../core/persistence/unit-of-work';
import type { IRefreshTokenPurger } from '../modules/auth/application/ports/refresh-token-purger.port';
import { PurgeExpiredRefreshTokensJob } from '../modules/auth/application/use-cases/purge-expired-refresh-tokens.job';
import type { IWorkspacePurger } from '../modules/workspace/application/ports/collaborators.port';
import type { IWorkspaceRepository } from '../modules/workspace/application/ports/repositories.port';
import { PurgeDeletedWorkspacesJob } from '../modules/workspace/application/use-cases/purge-deleted-workspaces.job';
import { PurgeRunBusyError } from '../modules/workspace/infrastructure/jobs/exclusive-purge-run';

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  /** Lệch ngẫu nhiên [0, jitterMs) cộng vào mỗi lần hẹn — các instance không chạy cùng giây. */
  jitterMs: number;
  /**
   * Lượt ĐẦU chạy sau khoảng này (+ jitter) thay vì cả `intervalMs` (review B T-033 F6): restart
   * thường xuyên hơn chu kỳ thì job không bao giờ chạy. Thiếu ⇒ `intervalMs`.
   */
  firstRunAfterMs?: number;
  /** `signal` bị hủy khi scheduler dừng (graceful shutdown — F7): job nên dừng giữa các bước. */
  run(signal?: AbortSignal): Promise<void>;
}

export interface SchedulerDeps {
  logger: ILogger;
  /** Mặc định `Math.random` — test truyền giá trị cố định. */
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => { unref?(): unknown };
  clearTimer?: (timer: unknown) => void;
}

/**
 * Scheduler job bảo trì trong process API (ADR-095: không thêm hàng đợi, không phụ thuộc Valkey).
 * `setTimeout` nối tiếp — lượt sau chỉ được hẹn khi lượt trước xong ⇒ không bao giờ chồng lượt
 * trong một instance. Timer `unref()` ⇒ không giữ process sống. Lỗi của job được log, lượt sau vẫn chạy.
 */
export class MaintenanceScheduler {
  readonly #timers = new Map<string, unknown>();
  readonly #running = new Set<Promise<void>>();
  #stopped = false;
  readonly #abort = new AbortController();

  constructor(
    private readonly jobs: readonly ScheduledJob[],
    private readonly d: SchedulerDeps,
  ) {}

  start(): void {
    for (const job of this.jobs) this.#schedule(job, true);
    this.d.logger.info({ jobs: this.jobs.map((j) => j.name) }, 'maintenance.started');
  }

  /** Graceful shutdown: không bắt đầu lượt mới; chờ lượt đang chạy tối đa `timeoutMs`. */
  async stop(timeoutMs: number): Promise<void> {
    this.#stopped = true;
    this.#abort.abort(); // lượt đang chạy thấy `signal.aborted` ⇒ dừng giữa các bước (F7)
    const clear = this.d.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout));
    for (const timer of this.#timers.values()) clear(timer);
    this.#timers.clear();
    if (this.#running.size === 0) return;
    let timedOut = false;
    await Promise.race([
      Promise.allSettled([...this.#running]),
      new Promise<void>((r) => setTimeout(() => ((timedOut = true), r()), timeoutMs).unref()),
    ]);
    if (timedOut) this.d.logger.warn({ timeoutMs }, 'maintenance.stop_timeout');
  }

  /** Chạy một lượt ngay (test / thao tác tay). Không chạy khi đã stop. */
  async runNow(job: ScheduledJob): Promise<void> {
    if (this.#stopped) return;
    const startedAt = Date.now();
    const p = job.run(this.#abort.signal).then(
      () =>
        this.d.logger.info(
          { job: job.name, durationMs: Date.now() - startedAt },
          'maintenance.run_done',
        ),
      (err: unknown) =>
        this.d.logger.error(
          // Chỉ tên + mã lỗi: message của lỗi Prisma có thể chứa dữ liệu truy vấn (T-031 mục 0).
          {
            job: job.name,
            durationMs: Date.now() - startedAt,
            errName: (err as Error | undefined)?.name,
            errCode: (err as { code?: unknown } | undefined)?.code,
            sqlState: dbSqlStateOf(err),
          },
          'maintenance.run_failed',
        ),
    );
    this.#running.add(p);
    try {
      await p;
    } finally {
      this.#running.delete(p);
    }
  }

  #schedule(job: ScheduledJob, first = false): void {
    if (this.#stopped) return;
    const base = first ? (job.firstRunAfterMs ?? job.intervalMs) : job.intervalMs;
    const delay = base + Math.floor((this.d.random ?? Math.random)() * job.jitterMs);
    const setTimer = this.d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const timer = setTimer(() => {
      void this.runNow(job).then(() => this.#schedule(job));
    }, delay);
    timer.unref?.();
    this.#timers.set(job.name, timer);
  }
}

/**
 * Lượt purge (ADR-047/095): job của Workspace (B) với purger đã bọc `ExclusivePurgeRun`.
 * Instance khác đang chạy lô ⇒ dừng lượt này (log info, không phải lỗi).
 */
/** Lượt purge đầu sau khi khởi động (+ jitter) — đủ để app ổn định, không chờ cả giờ (F6). */
export const PURGE_FIRST_RUN_AFTER_MS = 30_000;

export function purgeWorkspacesJob(d: {
  workspaces: IWorkspaceRepository;
  purger: IWorkspacePurger;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
  intervalMs: number;
  jitterMs: number;
}): ScheduledJob {
  const job = new PurgeDeletedWorkspacesJob(d);
  return {
    name: 'purge-deleted-workspaces',
    intervalMs: d.intervalMs,
    jitterMs: d.jitterMs,
    firstRunAfterMs: PURGE_FIRST_RUN_AFTER_MS,
    async run(signal) {
      if (signal?.aborted) return;
      try {
        const { purged, skipped, failed } = await job.execute(signal ? { signal } : {});
        const aborted = signal?.aborted ?? false;
        d.logger.info({ purged, skipped, failed, aborted }, 'maintenance.purge_summary');
        // G1 F4: lỗi từng workspace không còn dừng cả lô, nhưng lượt vẫn phải tính là THẤT BẠI để
        // `maintenance.run_failed` + metric `scheduled_job_runs_total{result="failure"}` còn báo động.
        if (failed > 0) throw new PurgeIncompleteError(failed);
      } catch (err) {
        if (!(err instanceof PurgeRunBusyError)) throw err;
        d.logger.info({}, 'maintenance.purge_skipped_busy');
      }
    },
  };
}

/** Lượt purge xong nhưng có workspace lỗi (đã log `workspace.purge_failed` từng cái). */
export class PurgeIncompleteError extends Error {
  constructor(readonly failed: number) {
    super(`Purge chưa xong: ${failed} workspace lỗi — thử lại lượt sau.`);
    this.name = 'PurgeIncompleteError';
  }
}

/** Dọn refresh token mỗi ngày (G2 S2); lượt đầu sau khởi động lệch khỏi purge workspace (30 s). */
export const REFRESH_TOKEN_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_PURGE_JITTER_MS = 30 * 60 * 1000;
export const REFRESH_TOKEN_PURGE_FIRST_RUN_AFTER_MS = 90_000;

/**
 * Lượt dọn refresh token (G2 S2, security.md §2.2). Log tổng kết chỉ có số đếm. Instance khác đang
 * chạy lô ⇒ `busy` (info, không phải lỗi). Chưa xóa hết (chạm trần lô) ⇒ lượt sau làm tiếp.
 */
export function purgeRefreshTokensJob(d: {
  purger: IRefreshTokenPurger;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}): ScheduledJob {
  const job = new PurgeExpiredRefreshTokensJob(d);
  return {
    name: 'purge-expired-refresh-tokens',
    intervalMs: REFRESH_TOKEN_PURGE_INTERVAL_MS,
    jitterMs: REFRESH_TOKEN_PURGE_JITTER_MS,
    firstRunAfterMs: REFRESH_TOKEN_PURGE_FIRST_RUN_AFTER_MS,
    async run(signal) {
      if (signal?.aborted) return;
      const { deleted, batches, busy, complete } = await job.execute(signal ? { signal } : {});
      const aborted = signal?.aborted ?? false;
      d.logger.info(
        { deleted, batches, busy, complete, aborted },
        'maintenance.refresh_token_purge_summary',
      );
    },
  };
}

/** Mặc định: bật ở staging/production, tắt ở local/test (env ghi đè được). */
export function maintenanceEnabled(
  appEnv: 'local' | 'test' | 'staging' | 'production',
  override: boolean | undefined,
): boolean {
  return override ?? (appEnv === 'staging' || appEnv === 'production');
}
