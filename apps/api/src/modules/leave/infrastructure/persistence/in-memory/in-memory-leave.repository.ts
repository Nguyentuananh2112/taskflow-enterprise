import type {
  ILeaveReadModel,
  LeaveListFilter,
  LeaveListKey,
  LeaveSummary,
} from '../../../application/ports/leave-read-model.port';
import type {
  ILeaveRepository,
  LeaveBalanceRecord,
  LeaveRequestRecord,
} from '../../../application/ports/leave.ports';
import type { CalendarDate, HalfDays } from '../../../domain/leave-days';
import { holdsBalance } from '../../../domain/leave-status';

interface State {
  requests: Map<string, LeaveRequestRecord>;
  balances: Map<string, LeaveBalanceRecord>;
}

const balanceKey = (user: string, year: number) => `${user}:${String(year)}`;
const byStart = (a: LeaveRequestRecord, b: LeaveRequestRecord) =>
  a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id);

/**
 * Repo + read model leave trong bộ nhớ cho test A — cùng hợp đồng với bản Prisma (phạm vi công ty). Snapshottable để
 * `FakeUnitOfWork` rollback thật. `lockUser` ghi lại thứ tự khóa (test kiểm "khóa TRƯỚC khi đọc").
 */
/** Dòng tạo lười (T-057): entitled NULL = theo chính sách, carried NULL = chưa chụp. */
const EMPTY_BALANCE: LeaveBalanceRecord = Object.freeze({
  entitled: null,
  adjustment: 0,
  carried: null,
});

export class InMemoryLeaveRepository implements ILeaveRepository, ILeaveReadModel {
  #s: State = { requests: new Map(), balances: new Map() };
  readonly locks: string[] = [];

  snapshot(): unknown {
    return { requests: new Map(this.#s.requests), balances: new Map(this.#s.balances) };
  }

  restore(snapshot: unknown): void {
    const s = snapshot as State;
    this.#s = { requests: new Map(s.requests), balances: new Map(s.balances) };
  }

  /** Test seed trực tiếp (không qua use case). */
  seed(record: LeaveRequestRecord): void {
    this.#s.requests.set(record.id, record);
  }

  rows(): LeaveRequestRecord[] {
    return [...this.#s.requests.values()];
  }

  lockUser(userId: string): Promise<void> {
    this.locks.push(`taskflow:leave:${userId}`);
    return Promise.resolve();
  }

  listHolding(userId: string, year: number): Promise<LeaveRequestRecord[]> {
    const y = String(year);
    return Promise.resolve(
      this.rows()
        .filter((r) => r.userId === userId && holdsBalance(r.status) && r.startDate.startsWith(y))
        .sort(byStart),
    );
  }

  listOpen(userId: string): Promise<LeaveRequestRecord[]> {
    return Promise.resolve(
      this.rows()
        .filter((r) => r.userId === userId && holdsBalance(r.status))
        .sort(byStart),
    );
  }

  find(id: string): Promise<LeaveRequestRecord | null> {
    return Promise.resolve(this.#s.requests.get(id) ?? null);
  }

  add(record: LeaveRequestRecord): Promise<void> {
    this.#s.requests.set(record.id, record);
    return Promise.resolve();
  }

  save(record: LeaveRequestRecord, expectedVersion: number): Promise<boolean> {
    const current = this.#s.requests.get(record.id);
    if (!current || current.version !== expectedVersion) return Promise.resolve(false);
    this.#s.requests.set(record.id, record);
    return Promise.resolve(true);
  }

  getOrCreateBalance(userId: string, year: number): Promise<LeaveBalanceRecord> {
    const key = balanceKey(userId, year);
    const found = this.#s.balances.get(key);
    if (found) return Promise.resolve(found);
    this.#s.balances.set(key, EMPTY_BALANCE);
    return Promise.resolve(EMPTY_BALANCE);
  }

  setBalanceAdjustment(userId: string, year: number, adjustment: HalfDays): Promise<void> {
    const key = balanceKey(userId, year);
    this.#s.balances.set(key, { ...(this.#s.balances.get(key) ?? EMPTY_BALANCE), adjustment });
    return Promise.resolve();
  }

  setCarried(
    userId: string,
    year: number,
    carried: HalfDays,
    mode: 'ifNull' | 'overwrite',
  ): Promise<void> {
    const key = balanceKey(userId, year);
    const current = this.#s.balances.get(key) ?? EMPTY_BALANCE;
    if (mode === 'overwrite' || current.carried === null) {
      this.#s.balances.set(key, { ...current, carried });
    }
    return Promise.resolve();
  }

  /** Test seed: ghi đè / phép chuyển sang đã chụp. */
  seedBalance(userId: string, year: number, balance: Partial<LeaveBalanceRecord>): void {
    const key = balanceKey(userId, year);
    this.#s.balances.set(key, { ...(this.#s.balances.get(key) ?? EMPTY_BALANCE), ...balance });
  }

  // ------------------------------------------------------------ phía đọc (ILeaveReadModel)

  listRequests(
    filter: LeaveListFilter,
    after: LeaveListKey | null,
    limit: number,
  ): Promise<LeaveRequestRecord[]> {
    const keyOf = (r: LeaveRequestRecord) => `${r.createdAt.toISOString()}|${r.id}`;
    const cut = after ? `${after.createdAt}|${after.id}` : null;
    return Promise.resolve(
      this.rows()
        .filter(
          (r) =>
            (filter.userId === undefined || r.userId === filter.userId) &&
            (filter.status === undefined || r.status === filter.status) &&
            (cut === null || keyOf(r) < cut),
        )
        .sort((a, b) => keyOf(b).localeCompare(keyOf(a)))
        .slice(0, limit),
    );
  }

  listApproved(q: {
    userIds?: readonly string[] | undefined;
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<LeaveRequestRecord[]> {
    return Promise.resolve(
      this.rows()
        .filter(
          (r) =>
            r.status === 'APPROVED' &&
            (q.userIds === undefined || q.userIds.includes(r.userId)) &&
            r.startDate <= q.to &&
            r.endDate >= q.from,
        )
        .sort(byStart),
    );
  }

  leaveSummaries(refIds: readonly string[]): Promise<ReadonlyMap<string, LeaveSummary>> {
    const out = new Map<string, LeaveSummary>();
    for (const id of refIds) {
      const r = this.#s.requests.get(id);
      if (r) out.set(r.id, { type: r.type, startDate: r.startDate, endDate: r.endDate });
    }
    return Promise.resolve(out);
  }

  findBalances(
    userIds: readonly string[],
    year: number,
  ): Promise<ReadonlyMap<string, LeaveBalanceRecord>> {
    const found = new Map<string, LeaveBalanceRecord>();
    for (const userId of userIds) {
      const b = this.#s.balances.get(balanceKey(userId, year));
      if (b) found.set(userId, b);
    }
    return Promise.resolve(found);
  }

  async listHoldingFor(userIds: readonly string[], year: number): Promise<LeaveRequestRecord[]> {
    const lists = await Promise.all(userIds.map((u) => this.listHolding(u, year)));
    return lists.flat();
  }

  findBalance(userId: string, year: number): Promise<LeaveBalanceRecord | null> {
    return Promise.resolve(this.#s.balances.get(balanceKey(userId, year)) ?? null);
  }
}
