import { isVisible, type NotificationRecord, type VisibilityScope } from '../domain/notification';
import type { INotificationStore, NotificationKey } from '../application/ports';

/** Thứ tự giảm dần theo (createdAt, id) — cùng thứ tự với ORDER BY của bản Prisma. */
const newerFirst = (a: NotificationKey, b: NotificationKey) =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** InMemory (dev/test) — tham gia snapshot/rollback của `InMemoryUnitOfWork` như repository khác. */
export class InMemoryNotificationStore implements INotificationStore {
  #rows = new Map<string, NotificationRecord>();

  rows(): NotificationRecord[] {
    return [...this.#rows.values()].map((r) => ({ ...r }));
  }

  snapshot(): unknown {
    return new Map([...this.#rows].map(([k, v]) => [k, { ...v }]));
  }

  restore(snapshot: unknown): void {
    this.#rows = snapshot as Map<string, NotificationRecord>;
  }

  addMany(records: readonly NotificationRecord[]): Promise<void> {
    for (const r of records) this.#rows.set(r.id, { ...r });
    return Promise.resolve();
  }

  list(
    scope: VisibilityScope,
    page: { after?: NotificationKey | undefined; limit: number },
  ): Promise<NotificationRecord[]> {
    const { after } = page;
    const rows = this.#visible(scope)
      .filter((r) => after === undefined || newerFirst(r, after) > 0)
      .sort(newerFirst)
      .slice(0, page.limit);
    return Promise.resolve(rows.map((r) => ({ ...r })));
  }

  countUnread(scope: VisibilityScope): Promise<number> {
    return Promise.resolve(this.#visible(scope).filter((r) => r.readAt === null).length);
  }

  markRead(scope: VisibilityScope, id: string, at: Date): Promise<boolean> {
    const row = this.#rows.get(id);
    if (!row || !isVisible(row, scope)) return Promise.resolve(false);
    row.readAt ??= at;
    return Promise.resolve(true);
  }

  markAllRead(scope: VisibilityScope, at: Date): Promise<number> {
    const unread = this.#visible(scope).filter((r) => r.readAt === null);
    for (const r of unread) r.readAt = at;
    return Promise.resolve(unread.length);
  }

  #visible(scope: VisibilityScope): NotificationRecord[] {
    return [...this.#rows.values()].filter((r) => isVisible(r, scope));
  }

  exists(q: { type: NotificationRecord['type']; refId: string }): Promise<boolean> {
    return Promise.resolve(
      [...this.#rows.values()].some((r) => r.type === q.type && r.refId === q.refId),
    );
  }
}
