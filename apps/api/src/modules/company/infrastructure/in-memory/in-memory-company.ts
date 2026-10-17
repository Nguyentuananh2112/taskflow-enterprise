import { ResourceConflictError } from '../../../../core/errors';
import type {
  CompanyProfile,
  CompanyTenure,
  CompanyTenureQuery,
  ICompanyMemberRepository,
  ICompanyRepository,
  ICompanyTenureReader,
  NewCompanyMember,
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
  company: CompanyProfile | null;
  members: Map<string, CompanyMemberSnapshot>;
  departures: CompanyDepartureRow[];
}

const copy = (s: State): State => ({
  company: s.company ? { ...s.company } : null,
  members: new Map([...s.members].map(([k, v]) => [k, { ...v, grants: [...v.grants] }])),
  departures: s.departures.map((d) => ({ ...d })),
});

/**
 * Bảng công ty trong bộ nhớ (dev / unit test). Có `snapshot` / `restore` để `FakeUnitOfWork` /
 * `InMemoryUnitOfWork` rollback như các bảng khác. Cùng ngữ nghĩa với bản Prisma (LSP).
 */
export class InMemoryCompanyStore
  implements ICompanyRepository, ICompanyMemberRepository, ICompanyTenureReader
{
  #state: State = { company: null, members: new Map(), departures: [] };

  get(): Promise<CompanyProfile | null> {
    return Promise.resolve(this.#state.company ? { ...this.#state.company } : null);
  }

  ensure(name: string): Promise<CompanyProfile> {
    this.#state.company ??= { name, version: 1 };
    return Promise.resolve({ ...this.#state.company });
  }

  find(userId: string): Promise<CompanyMemberSnapshot | null> {
    const m = this.#state.members.get(userId);
    return Promise.resolve(m ? { ...m, grants: [...m.grants] } : null);
  }

  /** Không có khóa thật trong bộ nhớ — như `find`. */
  findForShare(userId: string): Promise<CompanyMemberSnapshot | null> {
    return this.find(userId);
  }

  listHrManagerCandidates(): Promise<CompanyMemberSnapshot[]> {
    return Promise.resolve(
      this.members().filter((m) => m.role === 'ADMIN' || m.grants.includes('HR_MANAGE')),
    );
  }

  insert(input: NewCompanyMember): Promise<CompanyMemberSnapshot> {
    if (this.#state.members.has(input.userId)) {
      return Promise.reject(
        new ResourceConflictError({ reason: 'already_employee', field: 'email' }),
      );
    }
    const m: CompanyMemberSnapshot = {
      userId: input.userId,
      role: input.role,
      grants: [...input.grants],
      startDate: input.startDate,
      offboardLastDay: null,
      offboardAccessUntil: null,
      offboardScheduledById: null,
      version: 1,
      createdAt: input.at,
      updatedAt: input.at,
    };
    this.upsertMember(m);
    return this.find(input.userId) as Promise<CompanyMemberSnapshot>;
  }

  hasAdmin(): Promise<boolean> {
    return Promise.resolve(this.members().some((m) => m.role === 'ADMIN'));
  }

  listAdmins(): Promise<CompanyMemberSnapshot[]> {
    return Promise.resolve(
      this.members()
        .filter((m) => m.role === 'ADMIN')
        .sort((a, b) => (a.userId < b.userId ? -1 : 1)),
    );
  }

  /** Bộ nhớ: transaction tuần tự hóa sẵn — ghi lại thứ tự khóa để test kiểm (HIGH-1). */
  readonly locks: string[] = [];
  lockAdmins(): Promise<void> {
    this.locks.push('taskflow:company:admins');
    return Promise.resolve();
  }
  lockEmployeeWork(userId: string): Promise<void> {
    this.locks.push(`taskflow:leave:${userId}`, `taskflow:attendance:punch:${userId}`);
    return Promise.resolve();
  }

  promoteToAdmin(userId: string, at: Date): Promise<CompanyMemberSnapshot | null> {
    const m = this.#state.members.get(userId);
    if (!m || m.role !== 'EMPLOYEE') return Promise.resolve(null);
    this.upsertMember({
      ...m,
      role: 'ADMIN',
      grants: [],
      startDate: null,
      version: m.version + 1,
      updatedAt: at,
    });
    return this.find(userId);
  }

  recordDeparture(d: CompanyDepartureRow): Promise<void> {
    this.addDeparture(d);
    return Promise.resolve();
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
  setCompany(c: CompanyProfile | null): void {
    this.#state.company = c ? { ...c } : null;
  }
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
