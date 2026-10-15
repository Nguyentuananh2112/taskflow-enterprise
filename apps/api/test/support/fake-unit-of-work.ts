import {
  AfterCommitOutsideTransactionError,
  type AfterCommitHook,
  type IUnitOfWork,
  type UnitOfWorkOptions,
} from '../../src/core/persistence/unit-of-work';

/** InMemory repository đăng ký với FakeUnitOfWork để được rollback thật. */
export interface Snapshottable {
  snapshot(): unknown;
  restore(snapshot: unknown): void;
}

export type UowStep = 'begin' | 'commit' | 'rollback';

/**
 * UoW giả cho test U/A (test-spec §0.2): ghi thứ tự begin/commit/rollback, rollback trạng thái
 * InMemory bằng snapshot, chạy hook **sau** commit. Lỗi của hook bị giữ trong `hookErrors`
 * (giống bản thật: log, không ném).
 */
export class FakeUnitOfWork implements IUnitOfWork {
  readonly steps: UowStep[] = [];
  readonly hookErrors: unknown[] = [];
  readonly runOptions: UnitOfWorkOptions[] = [];
  readonly #participants: Snapshottable[] = [];
  #hooks: AfterCommitHook[] | undefined;

  constructor(...participants: Snapshottable[]) {
    this.#participants.push(...participants);
  }

  enlist(...participants: Snapshottable[]): this {
    this.#participants.push(...participants);
    return this;
  }

  get inTransaction(): boolean {
    return this.#hooks !== undefined;
  }

  get commits(): number {
    return this.steps.filter((s) => s === 'commit').length;
  }

  get rollbacks(): number {
    return this.steps.filter((s) => s === 'rollback').length;
  }

  async run<T>(work: () => Promise<T>, options: UnitOfWorkOptions = {}): Promise<T> {
    if (this.inTransaction) return work();

    this.runOptions.push(options);
    this.steps.push('begin');
    const snapshots = this.#participants.map((p) => p.snapshot());
    const hooks: AfterCommitHook[] = [];
    this.#hooks = hooks;
    let result: T;
    try {
      result = await work();
    } catch (err) {
      this.#participants.forEach((p, i) => p.restore(snapshots[i]));
      this.steps.push('rollback');
      throw err;
    } finally {
      this.#hooks = undefined;
    }
    this.steps.push('commit');
    for (const hook of hooks) {
      try {
        await hook();
      } catch (err) {
        this.hookErrors.push(err);
      }
    }
    return result;
  }

  afterCommit(hook: AfterCommitHook): void {
    if (!this.#hooks) throw new AfterCommitOutsideTransactionError();
    this.#hooks.push(hook);
  }
}
