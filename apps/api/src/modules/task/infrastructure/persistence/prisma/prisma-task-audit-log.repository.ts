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
    await this.db().taskAuditLog.create({ data: row(entry) });
  }

  /**
   * A3: `INSERT … SELECT unnest(...)` — 10 tham số mảng cho cả lô. `createMany` của Prisma 7 tốn
   * ~150–280 ms CPU cho 500 dòng có cột JSON (đo trên Postgres test). Mục JSON `null` ⇒ SQL NULL,
   * giống `json()` ở `append`.
   */
  async appendMany(entries: readonly TaskAuditEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const col = <T>(pick: (e: TaskAuditEntry) => T) => entries.map(pick);
    const jsonOf = (v: Record<string, unknown> | null) => (v === null ? null : JSON.stringify(v));
    await this.db().$executeRaw`
      INSERT INTO task_audit_logs (id, workspace_id, project_id, task_id, actor_id, action,
                                   old_value, new_value, request_id, created_at)
      SELECT * FROM unnest(${col((e) => e.id)}::uuid[], ${col((e) => e.workspaceId)}::uuid[],
                           ${col((e) => e.projectId)}::uuid[], ${col((e) => e.taskId)}::uuid[],
                           ${col((e) => e.actorId)}::uuid[], ${col((e) => e.action)}::"TaskAuditAction"[],
                           ${col((e) => jsonOf(e.oldValue))}::jsonb[], ${col((e) => jsonOf(e.newValue))}::jsonb[],
                           ${col((e) => e.requestId)}::varchar[],
                           ${col((e) => e.createdAt.toISOString())}::timestamptz[])`;
  }
}

function row(entry: TaskAuditEntry) {
  return {
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
  };
}
