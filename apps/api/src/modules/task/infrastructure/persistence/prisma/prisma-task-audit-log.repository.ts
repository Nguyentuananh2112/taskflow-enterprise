import { Prisma } from '../../../../../generated/prisma/client';
import type {
  ITaskAuditLogRepository,
  TaskAuditEntry,
} from '../../../application/ports/audit-log.port';
import type { DbProvider } from './db';

/** `null` của audit (vd oldValue của CREATED) = cột SQL NULL, không phải giá trị JSON `null`. */
const json = (v: Record<string, unknown> | null) =>
  v === null ? Prisma.DbNull : (v as Prisma.InputJsonObject);

/** Append-only (data-and-api §1.4): chỉ có INSERT, trong transaction của lệnh ghi (ADR-012). */
export class PrismaTaskAuditLogRepository implements ITaskAuditLogRepository {
  constructor(private readonly db: DbProvider) {}

  async append(entry: TaskAuditEntry): Promise<void> {
    await this.db().taskAuditLog.create({
      data: {
        id: entry.id,
        workspaceId: entry.workspaceId,
        projectId: entry.projectId,
        taskId: entry.taskId,
        actorId: entry.actorId,
        action: entry.action,
        oldValue: json(entry.oldValue),
        newValue: json(entry.newValue),
        requestId: entry.requestId,
        createdAt: entry.createdAt,
      },
    });
  }
}
