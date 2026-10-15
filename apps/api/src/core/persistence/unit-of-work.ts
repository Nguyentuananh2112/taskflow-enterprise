export type AfterCommitHook = () => void | Promise<void>;

export interface UnitOfWorkOptions {
  /** Mức cô lập của transaction (mặc định của Postgres: ReadCommitted). */
  isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

/**
 * Ranh giới transaction cho use case ghi (ADR-012).
 * - `run(work)`: mọi repository gọi bên trong dùng chung một transaction; `work` ném ⇒ rollback.
 *   Gọi lồng nhau ⇒ dùng lại transaction ngoài (không mở transaction mới).
 * - `afterCommit(hook)`: chỉ chạy khi transaction ngoài cùng **commit thành công**; lỗi của hook
 *   được log, không đổi kết quả của `run` (realtime fire-and-forget). Gọi ngoài `run` ⇒ ném lỗi.
 */
export interface IUnitOfWork {
  run<T>(work: () => Promise<T>, options?: UnitOfWorkOptions): Promise<T>;
  afterCommit(hook: AfterCommitHook): void;
  readonly inTransaction: boolean;
}

/** Tên gọi theo ADR-012/test-spec-task — cùng một hợp đồng. */
export type ITransactionManager = IUnitOfWork;

export class AfterCommitOutsideTransactionError extends Error {
  constructor() {
    super('afterCommit() chỉ được gọi bên trong uow.run() — không có transaction để chờ commit.');
    this.name = 'AfterCommitOutsideTransactionError';
  }
}
