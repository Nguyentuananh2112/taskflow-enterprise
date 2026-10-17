import { Prisma } from '../../../../generated/prisma/client';
import type {
  AuditPage,
  HrAuditEntry,
  HrAuditRow,
  IHrAuditLog,
} from '../../application/ports/hr-audit.port';
import type { HrAuditAction } from '../../domain/hr-audit';
import type { DbProvider } from './prisma-company';

const json = (v: HrAuditEntry['before']) =>
  v === null ? Prisma.DbNull : (v as Prisma.InputJsonObject);

/** HrAuditLog — chỉ thêm, dùng client của transaction hiện hành (gọi TRONG `uow.run` của bên gọi). */
export class PrismaHrAuditLog implements IHrAuditLog {
  constructor(private readonly db: DbProvider) {}

  async append(entry: HrAuditEntry): Promise<void> {
    await this.db().hrAuditLog.create({
      data: {
        id: entry.id,
        actorId: entry.actorId,
        action: entry.action,
        targetUserId: entry.targetUserId,
        refId: entry.refId,
        before: json(entry.before),
        after: json(entry.after),
        requestId: entry.requestId,
        createdAt: entry.createdAt,
      },
      select: { id: true },
    });
  }

  /** Keyset (createdAt, id) giảm dần — index `hr_audit_logs(created_at DESC, id DESC)`. */
  async list(page: { after?: string | undefined; limit: number }): Promise<AuditPage> {
    const anchor = page.after
      ? await this.db().hrAuditLog.findFirst({
          where: { id: page.after },
          select: { id: true, createdAt: true },
        })
      : null;
    if (page.after && !anchor) return { items: [], nextAfter: null };
    const rows = await this.db().hrAuditLog.findMany({
      where: {
        ...(anchor
          ? {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      select: {
        id: true,
        actorId: true,
        action: true,
        targetUserId: true,
        refId: true,
        before: true,
        after: true,
        requestId: true,
        createdAt: true,
        actor: { select: { fullName: true } },
      },
    });
    const items = rows.slice(0, page.limit).map(({ actor, ...r }) => ({
      ...r,
      action: r.action as HrAuditAction,
      before: (r.before ?? null) as HrAuditRow['before'],
      after: (r.after ?? null) as HrAuditRow['after'],
      actorName: actor?.fullName ?? null,
    }));
    return { items, nextAfter: rows.length > page.limit ? (items.at(-1)?.id ?? null) : null };
  }
}
