import type { IClock } from '../../../core/domain';
import { ResourceNotFoundError } from '../../../core/errors';
import {
  LEAVE_TYPES,
  PAYSLIP_TYPES,
  type NotificationRecord,
  type NotificationType,
  type VisibilityScope,
} from '../domain/notification';
import type {
  INotificationAudience,
  INotificationContextReader,
  INotificationStore,
  LeaveSummary,
  NotificationKey,
} from './ports';

/** = `NotificationDto` của contracts (parity ở notification.queries.test.ts). */
export interface NotificationView {
  id: string;
  type: NotificationType;
  refId: string;
  actor: { id: string; fullName: string; avatarUrl?: string | null } | null;
  leave: LeaveSummary | null;
  /** PAYSLIP_* (T-049): kỳ lương của phiếu — KHÔNG số tiền. */
  payslip: { period: string } | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationQueriesDeps {
  store: INotificationStore;
  audience: INotificationAudience;
  context: INotificationContextReader;
  clock: IClock;
}

/**
 * `GET/POST /api/v1/me/notifications…` — luôn của chính người gọi. Phạm vi hiển thị dựng lại MỖI request
 * từ tư cách công ty hiện tại (ADR-136; B-H3b: loại dành cho HR theo quyền hiện tại).
 */
export class NotificationQueries {
  constructor(private readonly d: NotificationQueriesDeps) {}

  async list(
    userId: string,
    page: { after?: NotificationKey | undefined; limit: number },
  ): Promise<{ items: NotificationView[]; nextAfter: NotificationKey | null }> {
    const scope = await this.#scope(userId);
    const rows = await this.d.store.list(scope, { after: page.after, limit: page.limit + 1 });
    const hasMore = rows.length > page.limit;
    const items = rows.slice(0, page.limit);
    const views = await this.#views(items);
    const last = items.at(-1);
    return {
      items: views,
      nextAfter: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.d.store.countUnread(await this.#scope(userId));
  }

  /** Id của người khác / loại HR khi đã mất quyền ⇒ 404 (không lộ tồn tại — SEC-HR-17). */
  async markRead(userId: string, id: string): Promise<void> {
    const scope = await this.#scope(userId);
    if (!(await this.d.store.markRead(scope, id, this.d.clock.now()))) {
      throw new ResourceNotFoundError('notification');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.d.store.markAllRead(await this.#scope(userId), this.d.clock.now());
  }

  async #scope(userId: string): Promise<VisibilityScope> {
    const access = await this.d.audience.accessOf(userId);
    return {
      recipientId: userId,
      access: access
        ? { since: access.since, hr: access.canManageHr, payroll: access.canManagePayroll }
        : null,
    };
  }

  async #views(rows: readonly NotificationRecord[]): Promise<NotificationView[]> {
    const actorIds = rows.flatMap((r) => (r.actorId ? [r.actorId] : []));
    const leaveRefs = rows.filter((r) => LEAVE_TYPES.includes(r.type)).map((r) => r.refId);
    const payslipRefs = rows.filter((r) => PAYSLIP_TYPES.includes(r.type)).map((r) => r.refId);
    const [actors, leaves, avatars, periods] = await Promise.all([
      this.d.context.actorNames(actorIds),
      this.d.context.leaveSummaries(leaveRefs),
      this.d.context.actorAvatars?.(actorIds),
      payslipRefs.length
        ? this.d.context.payslipPeriods(payslipRefs)
        : Promise.resolve(new Map<string, string>()),
    ]);
    return rows.map((r) => {
      const actorName = r.actorId ? actors.get(r.actorId) : undefined;
      const leave = LEAVE_TYPES.includes(r.type) ? leaves.get(r.refId) : undefined;
      return {
        id: r.id,
        type: r.type,
        refId: r.refId,
        actor:
          r.actorId && actorName !== undefined
            ? {
                id: r.actorId,
                fullName: actorName,
                ...(avatars ? { avatarUrl: avatars.get(r.actorId) ?? null } : {}),
              }
            : null,
        leave: leave
          ? { type: leave.type, startDate: leave.startDate, endDate: leave.endDate }
          : null,
        payslip:
          PAYSLIP_TYPES.includes(r.type) && periods.has(r.refId)
            ? { period: periods.get(r.refId)! }
            : null,
        readAt: r.readAt ? r.readAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
