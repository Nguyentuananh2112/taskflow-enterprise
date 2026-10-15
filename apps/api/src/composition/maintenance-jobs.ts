import type { IClock } from '../core/domain';
import type { ILogger } from '../core/logging/logger';
import type { IUnitOfWork } from '../core/persistence/unit-of-work';
import type { IWorkspacePurger } from '../modules/workspace/application/ports/collaborators.port';
import type { IWorkspaceRepository } from '../modules/workspace/application/ports/repositories.port';
import { PurgeDeletedWorkspacesJob } from '../modules/workspace/application/use-cases/purge-deleted-workspaces.job';
import { PurgeRunBusyError } from '../modules/workspace/infrastructure/jobs/exclusive-purge-run';

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  /** Lệch ngẫu nhiên [0, jitterMs) cộng vào mỗi lần hẹn — các instance không chạy cùng giây. */
  jitterMs: number;
  run(): Promise<void>;
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

  constructor(
    private readonly jobs: readonly ScheduledJob[],
    private readonly d: SchedulerDeps,
  ) {}

  start(): void {
    for (const job of this.jobs) this.#schedule(job);
    this.d.logger.info({ jobs: this.jobs.map((j) => j.name) }, 'maintenance.started');
  }

  /** Graceful shutdown: không bắt đầu lượt mới; chờ lượt đang chạy tối đa `timeoutMs`. */
  async stop(timeoutMs: number): Promise<void> {
    this.#stopped = true;
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
    const p = job.run().then(
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

  #schedule(job: ScheduledJob): void {
    if (this.#stopped) return;
    const delay = job.intervalMs + Math.floor((this.d.random ?? Math.random)() * job.jitterMs);
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
    async run() {
      try {
        const { purged, skipped } = await job.execute();
        d.logger.info({ purged, skipped }, 'maintenance.purge_summary');
      } catch (err) {
        if (!(err instanceof PurgeRunBusyError)) throw err;
        d.logger.info({}, 'maintenance.purge_skipped_busy');
      }
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
