import { AsyncLocalStorage } from 'node:async_hooks';

import type { ILogger } from '../core/logging/logger';
import { runAfterCommitHooks } from '../core/persistence/prisma-unit-of-work';
import {
  assertSnapshotTimeout,
  ReadSnapshotNestingError,
  type IReadSnapshot,
} from '../core/persistence/read-snapshot';
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

interface TxStore {
  readonly hooks: AfterCommitHook[];
  readonly readOnly?: true;
}

/**
 * UoW cho chế độ lưu trữ bộ nhớ (dev, khi chưa có Prisma — T-020). Rollback bằng snapshot của các
 * repository; transaction được **tuần tự hóa**: rollback snapshot của một request không được ghi
 * đè thay đổi đã commit của request khác.
 *
 * "Đang trong transaction" xác định theo **chuỗi async** (AsyncLocalStorage, như PrismaUnitOfWork):
 * chỉ `run()` lồng trong CHÍNH chuỗi đó mới dùng lại transaction; request khác chạy đồng thời phải
 * xếp hàng (lỗi QA F ở T-021: cờ chung của instance khiến request B chạy lọt vào transaction của A).
 */
export class InMemoryUnitOfWork implements IUnitOfWork {
  readonly #storage = new AsyncLocalStorage<TxStore>();
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly participants: readonly Snapshottable[],
    private readonly logger: ILogger,
  ) {}

  get inTransaction(): boolean {
    return this.#storage.getStore() !== undefined;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    const store = this.#storage.getStore();
    if (store?.readOnly) {
      return Promise.reject(new ReadSnapshotNestingError('write-in-snapshot'));
    }
    if (store) return work();
    const next = this.#tail.then(() => this.#runExclusive(work));
    this.#tail = next.catch(() => undefined);
    return next;
  }

  /**
   * `IReadSnapshot` bộ nhớ: không có MVCC ⇒ chỉ chạy `work` (dev/test), nhưng GIỮ luật cấm lồng cả hai chiều như
   * bản Prisma để test đơn vị bắt được lỗi lập trình sớm.
   */
  async readSnapshot<T>(work: () => Promise<T>, opts: { timeoutMs: number }): Promise<T> {
    if (this.inTransaction) throw new ReadSnapshotNestingError('in-unit-of-work');
    assertSnapshotTimeout(opts.timeoutMs);
    return this.#storage.run({ hooks: [], readOnly: true }, work);
  }

  readonly snapshot: IReadSnapshot = { run: (work, opts) => this.readSnapshot(work, opts) };

  async #runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const snapshots = this.participants.map((p) => p.snapshot());
    const store: TxStore = { hooks: [] };
    let result: T;
    try {
      result = await this.#storage.run(store, work);
    } catch (err) {
      this.participants.forEach((p, i) => p.restore(snapshots[i]));
      throw err;
    }
    await runAfterCommitHooks(store.hooks, this.logger);
    return result;
  }

  afterCommit(hook: AfterCommitHook): void {
    const store = this.#storage.getStore();
    if (!store) throw new AfterCommitOutsideTransactionError();
    store.hooks.push(hook);
  }
}
