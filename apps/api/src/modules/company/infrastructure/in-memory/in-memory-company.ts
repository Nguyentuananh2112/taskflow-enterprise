import type {
  CompanyTenure,
  CompanyTenureQuery,
  ICompanyMemberRepository,
  ICompanyTenureReader,
} from '../../application/ports/company-member.port';
import type { CompanyMemberSnapshot } from '../../domain/company-member';
import type { CompanyRole } from '../../domain/roles';

export interface CompanyDepartureRow {
  id: string;
  userId: string;
  role: CompanyRole;
  firstDay: string;
  lastDay: string;
  leftAt: Date;
  reason: 'OFFBOARDED' | 'ROLE_CHANGED';
}

interface State {
  members: Map<string, CompanyMemberSnapshot>;
  departures: CompanyDepartureRow[];
}

const copy = (s: State): State => ({
  members: new Map([...s.members].map(([k, v]) => [k, { ...v, grants: [...v.grants] }])),
  departures: s.departures.map((d) => ({ ...d })),
});

/**
 * Bảng công ty trong bộ nhớ (dev / unit test). Có `snapshot` / `restore` để `FakeUnitOfWork` /
 * `InMemoryUnitOfWork` rollback như các bảng khác. Cùng ngữ nghĩa với bản Prisma (LSP).
 */
export class InMemoryCompanyStore implements ICompanyMemberRepository, ICompanyTenureReader {
  #state: State = { members: new Map(), departures: [] };

  find(userId: string): Promise<CompanyMemberSnapshot | null> {
    const m = this.#state.members.get(userId);
    return Promise.resolve(m ? { ...m, grants: [...m.grants] } : null);
  }

  /** Không có khóa thật trong bộ nhớ — như `find`. */
  findForShare(userId: string): Promise<CompanyMemberSnapshot | null> {
    return this.find(userId);
  }

  tenuresOf(q: CompanyTenureQuery): Promise<CompanyTenure[]> {
    const wanted = (userId: string) => q.userIds === undefined || q.userIds.includes(userId);
    const current = [...this.#state.members.values()]
      .filter((m) => m.role === 'EMPLOYEE' && m.startDate !== null && wanted(m.userId))
      .map((m) => ({ userId: m.userId, from: m.startDate!, until: null }));
    const past = this.#state.departures
      .filter((d) => d.role === 'EMPLOYEE' && wanted(d.userId))
      .map((d) => ({ userId: d.userId, from: d.firstDay, until: d.lastDay }));
    return Promise.resolve(
      [...current, ...past]
        .filter((t) => t.from <= q.to && (t.until === null || t.until >= q.from))
        .sort((a, b) =>
          a.userId !== b.userId ? (a.userId < b.userId ? -1 : 1) : a.from < b.from ? -1 : 1,
        ),
    );
  }

  // ---- ghi (dùng bởi use case công ty + seed test)
  upsertMember(m: CompanyMemberSnapshot): void {
    this.#state.members.set(m.userId, { ...m, grants: [...m.grants] });
  }
  removeMember(userId: string): void {
    this.#state.members.delete(userId);
  }
  addDeparture(d: CompanyDepartureRow): void {
    this.#state.departures.push({ ...d });
  }
  members(): CompanyMemberSnapshot[] {
    return [...this.#state.members.values()].map((m) => ({ ...m, grants: [...m.grants] }));
  }
  departures(): CompanyDepartureRow[] {
    return this.#state.departures.map((d) => ({ ...d }));
  }

  snapshot(): unknown {
    return copy(this.#state);
  }
  restore(snapshot: unknown): void {
    this.#state = copy(snapshot as State);
  }
}
