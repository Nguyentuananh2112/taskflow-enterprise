import type { IClock } from '../domain';
import type { ILogger } from '../logging/logger';
import { STALE_TEMP_AGE_MS } from './infrastructure/local-fs';
import type { IFileStore } from './ports';

/**
 * Một bước dọn của `files-sweep` do module sở hữu dữ liệu đăng ký (ADR-141, mẫu T-033): upload chưa gắn > TTL,
 * blob không còn tham chiếu (T-069), avatar người đã rời + 30 ngày (T-068), `left_at` của participant (T-069).
 * Theo lô, idempotent, tự khóa advisory nếu chạm DB; XÓA DB TRƯỚC, đĩa SAU commit. Trả số mục đã dọn.
 */
export interface IFileSweepTask {
  readonly name: string;
  run(ctx: { now: Date; signal?: AbortSignal }): Promise<number>;
}

export class FileSweepRegistry {
  readonly #tasks: IFileSweepTask[] = [];

  register(task: IFileSweepTask): void {
    if (this.#tasks.some((t) => t.name === task.name)) {
      throw new Error(`bước files-sweep '${task.name}' đã đăng ký`);
    }
    this.#tasks.push(task);
  }

  get tasks(): readonly IFileSweepTask[] {
    return this.#tasks;
  }
}

/** Lượt xong nhưng có bước lỗi (đã log từng bước) ⇒ `maintenance.run_failed` + metric failure còn báo động. */
export class FilesSweepIncompleteError extends Error {
  constructor(readonly failed: readonly string[]) {
    super(`files-sweep chưa xong: ${failed.join(', ')}`);
    this.name = 'FilesSweepIncompleteError';
  }
}

/** Mỗi giờ + jitter (ADR-141); lượt đầu sau 60 s để app ổn định. `FILES_SWEEP_INTERVAL_MS` chỉ ở test. */
export const FILES_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
export const FILES_SWEEP_JITTER_MS = 5 * 60 * 1000;
export const FILES_SWEEP_FIRST_RUN_AFTER_MS = 60_000;
export const FILES_SWEEP_JOB = 'files-sweep';

export interface FilesSweepDeps {
  store: Pick<IFileStore, 'purgeStaleTemp'>;
  registry: FileSweepRegistry;
  clock: IClock;
  logger: ILogger;
  intervalMs?: number;
}

/**
 * Job `files-sweep` (dạng `ScheduledJob` của maintenance scheduler). Bước 1 (T-067): tệp tạm cũ hơn
 * `STALE_TEMP_AGE_MS` — lưới an toàn, đường chính xóa tmp ngay khi lỗi / hủy. Rồi các bước module đăng ký;
 * một bước lỗi không chặn bước sau.
 */
export function filesSweepJob(d: FilesSweepDeps) {
  const intervalMs = d.intervalMs ?? FILES_SWEEP_INTERVAL_MS;
  const testInterval = d.intervalMs !== undefined;
  return {
    name: FILES_SWEEP_JOB,
    intervalMs,
    jitterMs: testInterval ? 0 : FILES_SWEEP_JITTER_MS,
    firstRunAfterMs: testInterval ? intervalMs : FILES_SWEEP_FIRST_RUN_AFTER_MS,
    async run(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) return;
      const now = d.clock.now();
      const removed: Record<string, number> = {};
      const failed: string[] = [];
      try {
        removed['tmp'] = await d.store.purgeStaleTemp(new Date(now.getTime() - STALE_TEMP_AGE_MS));
      } catch (err) {
        failed.push('tmp');
        d.logger.error({ task: 'tmp', errName: (err as Error).name }, 'files.sweep_task_failed');
      }
      for (const task of d.registry.tasks) {
        if (signal?.aborted) break;
        try {
          removed[task.name] = await task.run(signal ? { now, signal } : { now });
        } catch (err) {
          failed.push(task.name);
          // Chỉ tên + mã: message lỗi Prisma có thể chứa dữ liệu truy vấn (T-031).
          d.logger.error(
            {
              task: task.name,
              errName: (err as Error).name,
              errCode: (err as { code?: unknown }).code,
            },
            'files.sweep_task_failed',
          );
        }
      }
      d.logger.info({ removed, failed, aborted: signal?.aborted ?? false }, 'files.sweep_summary');
      if (failed.length > 0) throw new FilesSweepIncompleteError(failed);
    },
  };
}
