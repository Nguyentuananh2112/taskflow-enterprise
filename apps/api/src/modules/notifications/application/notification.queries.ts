import type { IClock } from '../../../core/domain';
import { ResourceNotFoundError } from '../../../core/errors';
import {
  LEAVE_TYPES,
  type NotificationRecord,
  type NotificationType,
  type VisibilityScope,
} from '../domain/notification';
import type {
  CanManageHr,
  INotificationAudience,
  INotificationContextReader,
  INotificationStore,
  LeaveSummary,
} from './ports';

/** = `NotificationDto` của contracts (parity ở notification.queries.test.ts). */
export interface NotificationView {
  id: string;
  type: NotificationType;
  refId: string;
  workspaceId: string;
  workspaceName: string;
  actor: { id: string; fullName: string } | null;
  leave: LeaveSummary | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationQueriesDeps {
  store: INotificationStore;
  audience: INotificationAudience;
  context: INotificationContextReader;
  canManageHr: CanManageHr;
  clock: IClock;
}

/**
 * `GET/POST /api/v1/me/notifications…` — luôn của chính người gọi. Phạm vi hiển thị dựng lại MỖI request
 * từ membership hiện tại (ADR-123: chỉ ws còn là thành viên; B-H3b: loại dành cho HR theo quyền hiện tại).
 */
export class NotificationQueries {
  constructor(private readonly d: NotificationQueriesDeps) {}

  async list(
    userId: string,
    page: { after?: string | undefined; limit: number },
  ): Promise<{ items: NotificationView[]; nextAfter: string | null }> {
    const { scope, names } = await this.#scope(userId);
    const rows = await this.d.store.list(scope, { after: page.after, limit: page.limit + 1 });
    const hasMore = rows.length > page.limit;
    const items = rows.slice(0, page.limit);
    const views = await this.#views(items, names);
    return { items: views, nextAfter: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.d.store.countUnread((await this.#scope(userId)).scope);
  }

  /** Id của người khác / ws đã rời / loại HR khi đã mất quyền ⇒ 404 (không lộ tồn tại — SEC-HR-17). */
  async markRead(userId: string, id: string): Promise<void> {
    const { scope } = await this.#scope(userId);
    if (!(await this.d.store.markRead(scope, id, this.d.clock.now()))) {
      throw new ResourceNotFoundError('notification');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.d.store.markAllRead((await this.#scope(userId)).scope, this.d.clock.now());
  }

  async #scope(
    userId: string,
  ): Promise<{ scope: VisibilityScope; names: ReadonlyMap<string, string> }> {
    const memberships = await this.d.audience.workspacesOf(userId);
    const full: string[] = [];
    const basic: string[] = [];
    for (const m of memberships) {
      (this.d.canManageHr(m.role, m.grants) ? full : basic).push(m.workspaceId);
    }
    const names = new Map(memberships.map((m) => [m.workspaceId, m.workspaceName]));
    return { scope: { recipientId: userId, full, basic }, names };
  }

  async #views(
    rows: readonly NotificationRecord[],
    workspaceNames: ReadonlyMap<string, string>,
  ): Promise<NotificationView[]> {
    const actorIds = rows.flatMap((r) => (r.actorId ? [r.actorId] : []));
    const leaveRefs = rows
      .filter((r) => LEAVE_TYPES.includes(r.type))
      .map((r) => ({ workspaceId: r.workspaceId, refId: r.refId }));
    const [actors, leaves] = await Promise.all([
      this.d.context.actorNames(actorIds),
      this.d.context.leaveSummaries(leaveRefs),
    ]);
    return rows.map((r) => {
      const actorName = r.actorId ? actors.get(r.actorId) : undefined;
      const leave = LEAVE_TYPES.includes(r.type) ? leaves.get(r.refId) : undefined;
      return {
        id: r.id,
        type: r.type,
        refId: r.refId,
        workspaceId: r.workspaceId,
        workspaceName: workspaceNames.get(r.workspaceId) ?? '',
        actor: r.actorId && actorName !== undefined ? { id: r.actorId, fullName: actorName } : null,
        leave: leave
          ? { type: leave.type, startDate: leave.startDate, endDate: leave.endDate }
          : null,
        readAt: r.readAt ? r.readAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
