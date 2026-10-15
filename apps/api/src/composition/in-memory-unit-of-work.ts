import type { ILogger } from '../core/logging/logger';
import { runAfterCommitHooks } from '../core/persistence/prisma-unit-of-work';
import {
  AfterCommitOutsideTransactionError,
  type AfterCommitHook,
  type IUnitOfWork,
} from '../core/persistence/unit-of-work';

/** Repository InMemory có thể chụp/khôi phục trạng thái (B: `Table`, auth InMemory repos). */
export interface Snapshottable {
  snapshot(): unknown;
  restore(snapshot: unknown): void;
}

/**
 * UoW cho chế độ lưu trữ bộ nhớ (dev, khi chưa có Prisma — T-020). Rollback bằng snapshot của các
 * repository; transaction được **tuần tự hóa** bằng khóa: rollback snapshot của một request không
 * được ghi đè thay đổi đã commit của request khác chạy xen. Không dùng ở production.
 */
export class InMemoryUnitOfWork implements IUnitOfWork {
  #tail: Promise<unknown> = Promise.resolve();
  #hooks: AfterCommitHook[] | undefined;

  constructor(
    private readonly participants: readonly Snapshottable[],
    private readonly logger: ILogger,
  ) {}

  get inTransaction(): boolean {
    return this.#hooks !== undefined;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.inTransaction) return work();
    const next = this.#tail.then(() => this.#runExclusive(work));
    this.#tail = next.catch(() => undefined);
    return next;
  }

  async #runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const snapshots = this.participants.map((p) => p.snapshot());
    const hooks: AfterCommitHook[] = [];
    this.#hooks = hooks;
    let result: T;
    try {
      result = await work();
    } catch (err) {
      this.participants.forEach((p, i) => p.restore(snapshots[i]));
      throw err;
    } finally {
      this.#hooks = undefined;
    }
    await runAfterCommitHooks(hooks, this.logger);
    return result;
  }

  afterCommit(hook: AfterCommitHook): void {
    if (!this.#hooks) throw new AfterCommitOutsideTransactionError();
    this.#hooks.push(hook);
  }
}
