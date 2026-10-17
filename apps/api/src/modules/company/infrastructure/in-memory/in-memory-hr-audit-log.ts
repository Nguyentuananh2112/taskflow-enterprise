import type { AuditPage, HrAuditEntry, IHrAuditLog } from '../../application/ports/hr-audit.port';

/** HrAuditLog trong bộ nhớ (dev / unit test) — cùng ngữ nghĩa với `PrismaHrAuditLog`; có snapshot / restore. */
export class InMemoryHrAuditLog implements IHrAuditLog {
  #rows = new Map<string, HrAuditEntry>();

  constructor(private readonly nameOf: (userId: string) => string | undefined) {}

  append(entry: HrAuditEntry): Promise<void> {
    this.#rows.set(entry.id, { ...entry });
    return Promise.resolve();
  }

  list(page: { after?: string | undefined; limit: number }): Promise<AuditPage> {
    const all = this.rows().sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0),
    );
    const start = page.after ? all.findIndex((r) => r.id === page.after) + 1 : 0;
    const slice = (start > 0 || !page.after ? all.slice(start) : []).slice(0, page.limit + 1);
    const items = slice.slice(0, page.limit).map((r) => ({
      ...r,
      actorName: r.actorId === null ? null : (this.nameOf(r.actorId) ?? null),
    }));
    return Promise.resolve({
      items,
      nextAfter: slice.length > page.limit ? (items.at(-1)?.id ?? null) : null,
    });
  }

  rows(): HrAuditEntry[] {
    return [...this.#rows.values()].map((r) => ({ ...r }));
  }
  snapshot(): unknown {
    return new Map([...this.#rows].map(([k, v]) => [k, { ...v }]));
  }
  restore(snapshot: unknown): void {
    this.#rows = snapshot as Map<string, HrAuditEntry>;
  }
}
