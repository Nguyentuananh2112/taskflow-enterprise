import type { ILeavePolicyStore, LeavePolicyRow } from '../../../application/ports/leave.ports';
import type { LeavePolicy } from '../../../domain/leave-policy';

/**
 * `leave_policies` trong bộ nhớ (dev / unit test, T-057). Khóa không làm gì nhưng GHI LẠI thứ tự (test kiểm
 * "policy shared trước leave:<user>"); có snapshot / restore cho `InMemoryUnitOfWork`.
 */
export class InMemoryLeavePolicyStore implements ILeavePolicyStore {
  #rows = new Map<number, LeavePolicyRow>();
  readonly locks: string[] = [];

  constructor(private readonly recordLock: (name: string) => void = () => undefined) {}

  lock(mode: 'shared' | 'exclusive'): Promise<void> {
    const name = `taskflow:leave-policy:${mode}`;
    this.locks.push(name);
    this.recordLock(name);
    return Promise.resolve();
  }

  list(): Promise<LeavePolicyRow[]> {
    return Promise.resolve([...this.#rows.values()].sort((a, b) => a.year - b.year));
  }

  put(input: {
    year: number;
    policy: LeavePolicy;
    expectedVersion: number;
    updatedById: string;
    at: Date;
  }): Promise<LeavePolicyRow | null> {
    const current = this.#rows.get(input.year);
    if ((current?.version ?? 0) !== input.expectedVersion) return Promise.resolve(null);
    const row: LeavePolicyRow = {
      year: input.year,
      policy: { ...input.policy },
      version: (current?.version ?? 0) + 1,
      updatedById: input.updatedById,
      updatedAt: input.at,
    };
    this.#rows.set(input.year, row);
    return Promise.resolve(row);
  }

  snapshot(): unknown {
    return new Map(this.#rows);
  }

  restore(snapshot: unknown): void {
    this.#rows = new Map(snapshot as Map<number, LeavePolicyRow>);
  }
}
