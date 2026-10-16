import type { Prisma } from '../../../../generated/prisma/client';
import {
  HR_AUDIENCE_TYPES,
  type NotificationRecord,
  type VisibilityScope,
} from '../../domain/notification';
import type { INotificationStore } from '../../application/ports';

/** = `uow.db()` của `PrismaUnitOfWork` — trong `run()` là transaction của bên gọi (ADR-012, ADR-123). */
export type DbProvider = () => Prisma.TransactionClient;

/**
 * Cùng điều kiện với `isVisible` (domain): `recipient_id = me` LUÔN có trong WHERE (B-M3); ws `full` thấy
 * mọi loại, ws `basic` ẩn loại dành cho HR (B-H3b); ws khác ⇒ không khớp. Danh sách rỗng ⇒ `IN ()` sai.
 */
export function visibleWhere(scope: VisibilityScope): Prisma.NotificationWhereInput {
  return {
    recipientId: scope.recipientId,
    OR: [
      { workspaceId: { in: [...scope.full] } },
      { workspaceId: { in: [...scope.basic] }, type: { notIn: [...HR_AUDIENCE_TYPES] } },
    ],
  };
}

const SELECT = {
  id: true,
  workspaceId: true,
  recipientId: true,
  type: true,
  refId: true,
  actorId: true,
  readAt: true,
  createdAt: true,
} as const satisfies Prisma.NotificationSelect;

export class PrismaNotificationStore implements INotificationStore {
  constructor(private readonly db: DbProvider) {}

  async addMany(records: readonly NotificationRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.db().notification.createMany({ data: records.map((r) => ({ ...r })) });
  }

  async list(
    scope: VisibilityScope,
    page: { after?: string | undefined; limit: number },
  ): Promise<NotificationRecord[]> {
    const rows = await this.db().notification.findMany({
      where: {
        AND: [visibleWhere(scope), ...(page.after ? [{ id: { lt: page.after } }] : [])],
      },
      orderBy: { id: 'desc' },
      take: page.limit,
      select: SELECT,
    });
    return rows;
  }

  countUnread(scope: VisibilityScope): Promise<number> {
    return this.db().notification.count({
      where: { AND: [visibleWhere(scope), { readAt: null }] },
    });
  }

  async markRead(scope: VisibilityScope, id: string, at: Date): Promise<boolean> {
    const where = { AND: [visibleWhere(scope), { id }] };
    const { count } = await this.db().notification.updateMany({
      where: { AND: [...where.AND, { readAt: null }] },
      data: { readAt: at },
    });
    if (count > 0) return true;
    // Đã đọc trước đó ⇒ vẫn 2xx (idempotent); không thấy được ⇒ 404.
    return (await this.db().notification.count({ where })) > 0;
  }

  async markAllRead(scope: VisibilityScope, at: Date): Promise<number> {
    const { count } = await this.db().notification.updateMany({
      where: { AND: [visibleWhere(scope), { readAt: null }] },
      data: { readAt: at },
    });
    return count;
  }
}
