import type { Prisma } from '../../../../generated/prisma/client';
import {
  HR_AUDIENCE_TYPES,
  PAYROLL_AUDIENCE_TYPES,
  type NotificationRecord,
  type VisibilityScope,
} from '../../domain/notification';
import type { INotificationStore, NotificationKey } from '../../application/ports';

/** = `uow.db()` của `PrismaUnitOfWork` — trong `run()` là transaction của bên gọi (ADR-012, ADR-123). */
export type DbProvider = () => Prisma.TransactionClient;

/**
 * Cùng điều kiện với `isVisible` (domain): `recipient_id = me` LUÔN có trong WHERE (B-M3);
 * `created_at ≥ since` (tư cách công ty hiện tại — T-040b L3); không `hr:manage` ⇒ ẩn loại HR (B-H3b).
 * Không còn thuộc công ty ⇒ điều kiện luôn sai TƯỜNG MINH (`id IN ()` — không dựa vào `OR: []`, vốn KHỚP
 * MỌI DÒNG trong Prisma, SEC-HR-18).
 */
export function visibleWhere(scope: VisibilityScope): Prisma.NotificationWhereInput {
  if (!scope.access) return { recipientId: scope.recipientId, id: { in: [] } };
  return {
    recipientId: scope.recipientId,
    createdAt: { gte: scope.access.since },
    type: {
      notIn: [
        ...(scope.access.hr ? [] : HR_AUDIENCE_TYPES),
        ...(scope.access.payroll === true ? [] : PAYROLL_AUDIENCE_TYPES),
      ],
    },
  };
}

const SELECT = {
  id: true,
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
    page: { after?: NotificationKey | undefined; limit: number },
  ): Promise<NotificationRecord[]> {
    const { after } = page;
    const rows = await this.db().notification.findMany({
      where: {
        AND: [
          visibleWhere(scope),
          ...(after
            ? [
                {
                  OR: [
                    { createdAt: { lt: after.createdAt } },
                    { createdAt: after.createdAt, id: { lt: after.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
