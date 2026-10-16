import { Prisma } from '../../../../../generated/prisma/client';
import type {
  HrAuditEntry,
  HrAuditRow,
  IHrAuditLog,
} from '../../../application/ports/hr-audit.port';
import type { Page, PageRequest } from '../../../application/ports/queries.port';
import type { HrAuditAction } from '../../../domain/hr-audit';
import type { DbProvider } from './db';

const json = (v: HrAuditEntry['before']) =>
  v === null ? Prisma.DbNull : (v as Prisma.InputJsonObject);

/** HrAuditLog — chỉ thêm, dùng client của transaction hiện hành (gọi TRONG `uow.run` của bên gọi). */
export class PrismaHrAuditLog implements IHrAuditLog {
  constructor(private readonly db: DbProvider) {}

  async append(entry: HrAuditEntry): Promise<void> {
    await this.db().hrAuditLog.create({
      data: {
        id: entry.id,
        workspaceId: entry.workspaceId,
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

  /** Keyset (createdAt, id) giảm dần — index `hr_audit_logs(workspace_id, created_at DESC, id DESC)`. */
  async list(workspaceId: string, page: PageRequest): Promise<Page<HrAuditRow>> {
    const anchor = page.after
      ? await this.db().hrAuditLog.findFirst({
          where: { id: page.after, workspaceId },
          select: { id: true, createdAt: true },
        })
      : null;
    if (page.after && !anchor) return { items: [], nextAfter: null };
    const rows = await this.db().hrAuditLog.findMany({
      where: {
        workspaceId,
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
        workspaceId: true,
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
      actorName: actor.fullName,
    }));
    return { items, nextAfter: rows.length > page.limit ? (items.at(-1)?.id ?? null) : null };
  }
}
