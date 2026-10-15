import { AsyncLocalStorage } from 'node:async_hooks';

import type { ILogger } from '../logging/logger';
import {
  AfterCommitOutsideTransactionError,
  type AfterCommitHook,
  type IUnitOfWork,
  type UnitOfWorkOptions,
} from './unit-of-work';

/**
 * Phần tối thiểu của PrismaClient mà UoW cần — interactive transaction.
 * Khai báo cấu trúc để core không phụ thuộc client sinh ra (schema thuộc T-010).
 */
export interface TransactionCapable<TTx> {
  $transaction<R>(
    fn: (tx: TTx) => Promise<R>,
    options?: {
      isolationLevel?: UnitOfWorkOptions['isolationLevel'];
      maxWait?: number;
      timeout?: number;
    },
  ): Promise<R>;
}

interface TxStore<TTx> {
  readonly tx: TTx;
  readonly hooks: AfterCommitHook[];
}

export interface PrismaUnitOfWorkOptions {
  /** Thời gian tối đa chờ lấy connection (ms). */
  maxWait?: number;
  /** Thời gian tối đa của một transaction (ms) — giữ ngắn, không gọi mạng ngoài trong transaction. */
  timeout?: number;
}

/**
 * UoW trên Prisma interactive transaction + AsyncLocalStorage (ADR-012).
 * Repository lấy client hiện hành qua `db()`: trong `run()` là transaction, ngoài là client gốc.
 *
 * `TDb` là kiểu client mà repository dùng (vd `Prisma.TransactionClient`); client gốc phải
 * gán được vào `TDb` (PrismaClient thỏa điều này).
 */
export class PrismaUnitOfWork<TDb> implements IUnitOfWork {
  readonly #storage = new AsyncLocalStorage<TxStore<TDb>>();

  constructor(
    private readonly client: TransactionCapable<TDb> & TDb,
    private readonly logger: ILogger,
    private readonly options: PrismaUnitOfWorkOptions = {},
  ) {}

  get inTransaction(): boolean {
    return this.#storage.getStore() !== undefined;
  }

  /** Client cho repository: transaction đang mở, hoặc client gốc nếu không trong `run()`. */
  db(): TDb {
    return this.#storage.getStore()?.tx ?? this.client;
  }

  async run<T>(work: () => Promise<T>, options: UnitOfWorkOptions = {}): Promise<T> {
    if (this.inTransaction) return work();

    const hooks: AfterCommitHook[] = [];
    const result = await this.client.$transaction((tx) => this.#storage.run({ tx, hooks }, work), {
      ...this.options,
      ...options,
    });
    await runAfterCommitHooks(hooks, this.logger);
    return result;
  }

  afterCommit(hook: AfterCommitHook): void {
    const store = this.#storage.getStore();
    if (!store) throw new AfterCommitOutsideTransactionError();
    store.hooks.push(hook);
  }
}

/** Chạy hook tuần tự theo thứ tự đăng ký; lỗi được log rồi chạy tiếp (fire-and-forget, ADR-012). */
export async function runAfterCommitHooks(
  hooks: readonly AfterCommitHook[],
  logger: ILogger,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook();
    } catch (err) {
      logger.error({ err, hook: hook.name || 'anonymous' }, 'uow.after_commit_failed');
    }
  }
}
