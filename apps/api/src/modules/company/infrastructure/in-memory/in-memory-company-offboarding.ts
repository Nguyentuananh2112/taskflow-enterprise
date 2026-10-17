import type {
  DepartedEmployee,
  ICompanyOffboardingRepository,
} from '../../application/ports/offboarding.port';
import type { CompanyMemberSnapshot } from '../../domain/company-member';
import type { InMemoryCompanyStore } from './in-memory-company';

/**
 * Bản bộ nhớ của `ICompanyOffboardingRepository` — đọc / ghi CHÍNH `InMemoryCompanyStore` (cùng snapshot / restore
 * của UoW). Cùng ngữ nghĩa với bản Prisma (LSP).
 */
export class InMemoryCompanyOffboarding implements ICompanyOffboardingRepository {
  constructor(private readonly store: InMemoryCompanyStore) {}

  async schedule(input: Parameters<ICompanyOffboardingRepository['schedule']>[0]) {
    const m = await this.store.find(input.userId);
    if (!m) return null;
    const next: CompanyMemberSnapshot = {
      ...m,
      offboardLastDay: input.lastDay,
      offboardAccessUntil: input.accessUntil,
      offboardScheduledById: input.scheduledById,
      version: m.version + 1,
      updatedAt: input.at,
    };
    this.store.upsertMember(next);
    return next;
  }

  async cancel(userId: string, at: Date) {
    const m = await this.store.find(userId);
    if (!m || m.offboardLastDay === null) return null;
    const next: CompanyMemberSnapshot = {
      ...m,
      offboardLastDay: null,
      offboardAccessUntil: null,
      offboardScheduledById: null,
      version: m.version + 1,
      updatedAt: at,
    };
    this.store.upsertMember(next);
    return next;
  }

  async deleteIfDue(userId: string, now: Date) {
    const m = await this.store.find(userId);
    if (!m?.offboardAccessUntil || m.offboardAccessUntil.getTime() > now.getTime()) return null;
    this.store.removeMember(userId);
    return m;
  }

  listDue(now: Date, limit: number) {
    return Promise.resolve(
      this.store
        .members()
        .filter((m) => m.offboardAccessUntil && m.offboardAccessUntil.getTime() <= now.getTime())
        .sort(
          (a, b) =>
            a.offboardAccessUntil!.getTime() - b.offboardAccessUntil!.getTime() ||
            (a.userId < b.userId ? -1 : 1),
        )
        .slice(0, limit)
        .map((m) => m.userId),
    );
  }

  listEmployees() {
    return Promise.resolve(this.store.members().filter((m) => m.role === 'EMPLOYEE'));
  }

  listMembersByIds(userIds: readonly string[]) {
    return Promise.resolve(this.store.members().filter((m) => userIds.includes(m.userId)));
  }

  listDeparted(): Promise<DepartedEmployee[]> {
    const current = new Set(this.store.members().map((m) => m.userId));
    const latest = new Map<string, DepartedEmployee>();
    for (const d of this.store.departures()) {
      if (current.has(d.userId)) continue;
      const prev = latest.get(d.userId);
      if (!prev || d.lastDay > prev.lastDay) {
        latest.set(d.userId, { userId: d.userId, firstDay: d.firstDay, lastDay: d.lastDay });
      }
    }
    return Promise.resolve([...latest.values()]);
  }
}
