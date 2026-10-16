import { DEFAULT_ENTITLED_HALF_DAYS } from '../../../domain/leave-balance';
import type { HalfDays } from '../../../domain/leave-days';
import { holdsBalance } from '../../../domain/leave-status';
import type {
  ILeaveReadModel,
  LeaveListFilter,
  LeaveListKey,
} from '../../../application/ports/leave-read-model.port';
import type {
  ILeaveRepository,
  LeaveBalanceRecord,
  LeaveRequestRecord,
} from '../../../application/ports/leave.ports';
import type { CalendarDate } from '../../../domain/leave-days';

interface State {
  requests: Map<string, LeaveRequestRecord>;
  balances: Map<string, LeaveBalanceRecord>;
}

const balanceKey = (ws: string, user: string, year: number) => `${ws}:${user}:${String(year)}`;

/**
 * Repo + read model leave trong bộ nhớ cho test A (test-spec §0.1) — cùng hợp đồng với bản Prisma. Snapshottable để
 * `FakeUnitOfWork` rollback thật. `lockUser` ghi lại thứ tự khóa (test kiểm "khóa TRƯỚC khi đọc").
 */
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

  lockUser(workspaceId: string, userId: string): Promise<void> {
    this.locks.push(`taskflow:leave:${workspaceId}:${userId}`);
    return Promise.resolve();
  }

  listHolding(workspaceId: string, userId: string, year: number): Promise<LeaveRequestRecord[]> {
    const y = String(year);
    return Promise.resolve(
      [...this.#s.requests.values()]
        .filter(
          (r) =>
            r.workspaceId === workspaceId &&
            r.userId === userId &&
            holdsBalance(r.status) &&
            r.startDate.startsWith(y),
        )
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)),
    );
  }

  find(workspaceId: string, id: string): Promise<LeaveRequestRecord | null> {
    const r = this.#s.requests.get(id);
    return Promise.resolve(r && r.workspaceId === workspaceId ? r : null);
  }

  add(record: LeaveRequestRecord): Promise<void> {
    this.#s.requests.set(record.id, record);
    return Promise.resolve();
  }

  save(record: LeaveRequestRecord, expectedVersion: number): Promise<boolean> {
    const current = this.#s.requests.get(record.id);
    if (
      !current ||
      current.workspaceId !== record.workspaceId ||
      current.version !== expectedVersion
    ) {
      return Promise.resolve(false);
    }
    this.#s.requests.set(record.id, record);
    return Promise.resolve(true);
  }

  getOrCreateBalance(
    workspaceId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalanceRecord> {
    const key = balanceKey(workspaceId, userId, year);
    if (!this.#s.balances.has(key))
      this.#s.balances.set(key, { entitled: DEFAULT_ENTITLED_HALF_DAYS, adjustment: 0 });
    return Promise.resolve(this.#s.balances.get(key)!);
  }

  setBalanceAdjustment(
    workspaceId: string,
    userId: string,
    year: number,
    adjustment: HalfDays,
  ): Promise<void> {
    const key = balanceKey(workspaceId, userId, year);
    const current = this.#s.balances.get(key) ?? {
      entitled: DEFAULT_ENTITLED_HALF_DAYS,
      adjustment: 0,
    };
    this.#s.balances.set(key, { ...current, adjustment });
    return Promise.resolve();
  }

  hasHistory(workspaceId: string, userId: string): Promise<boolean> {
    const inRequests = [...this.#s.requests.values()].some(
      (r) => r.workspaceId === workspaceId && r.userId === userId,
    );
    const inBalances = [...this.#s.balances.keys()].some((k) =>
      k.startsWith(`${workspaceId}:${userId}:`),
    );
    return Promise.resolve(inRequests || inBalances);
  }

  // ------------------------------------------------------------ phía đọc (ILeaveReadModel)

  listRequests(
    workspaceId: string,
    filter: LeaveListFilter,
    after: LeaveListKey | null,
    limit: number,
  ): Promise<LeaveRequestRecord[]> {
    const keyOf = (r: LeaveRequestRecord) => `${r.createdAt.toISOString()}|${r.id}`;
    const cut = after ? `${after.createdAt}|${after.id}` : null;
    return Promise.resolve(
      [...this.#s.requests.values()]
        .filter(
          (r) =>
            r.workspaceId === workspaceId &&
            (filter.userId === undefined || r.userId === filter.userId) &&
            (filter.status === undefined || r.status === filter.status) &&
            (cut === null || keyOf(r) < cut),
        )
        .sort((a, b) => keyOf(b).localeCompare(keyOf(a)))
        .slice(0, limit),
    );
  }

  listApproved(q: {
    workspaceId: string;
    userIds?: readonly string[] | undefined;
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<LeaveRequestRecord[]> {
    return Promise.resolve(
      [...this.#s.requests.values()]
        .filter(
          (r) =>
            r.workspaceId === q.workspaceId &&
            r.status === 'APPROVED' &&
            (q.userIds === undefined || q.userIds.includes(r.userId)) &&
            r.startDate <= q.to &&
            r.endDate >= q.from,
        )
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)),
    );
  }

  async findBalances(
    workspaceId: string,
    userIds: readonly string[],
    year: number,
  ): Promise<ReadonlyMap<string, LeaveBalanceRecord>> {
    const found = new Map<string, LeaveBalanceRecord>();
    for (const userId of userIds) {
      const b = await this.findBalance(workspaceId, userId, year);
      if (b) found.set(userId, b);
    }
    return found;
  }

  async listHoldingFor(
    workspaceId: string,
    userIds: readonly string[],
    year: number,
  ): Promise<LeaveRequestRecord[]> {
    const lists = await Promise.all(userIds.map((u) => this.listHolding(workspaceId, u, year)));
    return lists.flat();
  }

  findBalance(
    workspaceId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalanceRecord | null> {
    return Promise.resolve(this.#s.balances.get(balanceKey(workspaceId, userId, year)) ?? null);
  }
}
