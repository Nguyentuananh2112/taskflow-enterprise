import type { AuditLogDto, TaskDto } from '@taskflow/contracts';

import { Prisma } from '../../../../../generated/prisma/client';
import type {
  AuditLogKey,
  ITaskReadModel,
  TaskListFilter,
  TaskListKey,
} from '../../../application/ports/task-read-model.port';
import { taskKey } from '../../../application/task-dto';
import { TASK_STATUSES, type TaskStatus } from '../../../domain/task-status';
import { toDateOnly, type DbProvider } from './db';

const USER_REF = { select: { id: true, fullName: true } } as const;

/**
 * perf/task-read-raw: đọc task bằng MỘT câu SQL (JOIN project + workspace + 2× user) thay cho `findMany`
 * có `select` lồng — Prisma 7.10 tải quan hệ bằng 3 câu riêng (`projects`/`users` `IN (…)` 200 tham số)
 * và tốn ~2× CPU tiến trình (đo: 200 task, 6,4–8,3 ms ⇒ 3,0–3,6 ms). DTO giữ y hệt (ADR-015).
 * Đổi cột của `tasks`/`users`/`projects` ⇒ phải sửa `SELECT` + `TaskRow` dưới đây.
 */
interface TaskRow {
  id: string;
  workspace_id: string;
  project_id: string;
  number: number;
  title: string;
  description: string | null;
  status: TaskDto['status'];
  priority: TaskDto['priority'];
  rank: string;
  version: number;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
  key_prefix: string;
  assignee_id: string | null;
  assignee_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
}

const ref = (id: string | null, fullName: string | null) =>
  id === null || fullName === null ? null : { id, fullName };

export function taskDtoOfRow(r: TaskRow): TaskDto {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    number: r.number,
    key: taskKey(r.key_prefix, r.number),
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    rank: r.rank,
    version: r.version,
    dueDate: toDateOnly(r.due_date),
    assignee: ref(r.assignee_id, r.assignee_name),
    createdBy: ref(r.creator_id, r.creator_name),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/**
 * Task sống ∈ project ∈ workspace chưa xóa mềm (ADR-020, ADR-047): 3 điều kiện tenant + `deleted_at`.
 * JOIN project theo cặp `(id, workspace_id)` như FK kép D6. Mọi giá trị đều là tham số (`Prisma.sql`).
 */
const selectTasks = (workspaceId: string, projectId: string, where: Prisma.Sql) => Prisma.sql`
  SELECT t.id, t.workspace_id, t.project_id, t.number, t.title, t.description,
         t.status::text AS status, t.priority::text AS priority, t.rank, t.version, t.due_date,
         t.created_at, t.updated_at, p.key_prefix,
         a.id AS assignee_id, a.full_name AS assignee_name,
         c.id AS creator_id, c.full_name AS creator_name
    FROM tasks t
    JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    JOIN workspaces w ON w.id = t.workspace_id AND w.deleted_at IS NULL
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users c ON c.id = t.created_by_id
   WHERE t.workspace_id = ${workspaceId}::uuid AND t.project_id = ${projectId}::uuid
     AND t.deleted_at IS NULL AND ${where}`;

/** `taskExists` (audit-log): task ∈ project ∈ workspace chưa xóa — task đã xóa mềm vẫn tính (R16). */
const scoped = (workspaceId: string, projectId: string): Prisma.TaskWhereInput => ({
  workspaceId,
  projectId,
  project: { workspace: { deletedAt: null } },
});

const TRUE = Prisma.sql`TRUE`;
const status = (s: TaskStatus) => Prisma.sql`${s}::"TaskStatus"`;
/** Trong CÙNG status: sau `(rank, id)` — rank so theo collation "C" của cột. */
const afterInStatus = (k: TaskListKey) =>
  Prisma.sql`(t.rank > ${k.rank} OR (t.rank = ${k.rank} AND t.id > ${k.id}::uuid))`;

/**
 * Keyset sau `(status, rank, id)`, khớp `ORDER BY t.status, t.rank, t.id` (enum theo thứ tự khai báo).
 * Có lọc status (đường nóng của board) ⇒ chỉ so `(rank, id)` để điều kiện là `project_id =, status =,
 * rank >` — tiền tố của `tasks_rank_live_key`. Cursor của status khác (chỉ khi client tự chế) giữ đúng
 * ngữ nghĩa so sánh bộ: status trước ⇒ không lọc thêm, status sau ⇒ rỗng.
 */
function keyset(filter: TaskListFilter, key: TaskListKey | null): Prisma.Sql | null {
  if (!key) return TRUE;
  if (filter.status) {
    const diff = TASK_STATUSES.indexOf(key.status) - TASK_STATUSES.indexOf(filter.status);
    if (diff !== 0) return diff < 0 ? TRUE : null;
    return afterInStatus(key);
  }
  return Prisma.sql`(t.status > ${status(key.status)}
    OR (t.status = ${status(key.status)} AND ${afterInStatus(key)}))`;
}

/** Phía đọc CQRS-lite (ADR-015): `select` thẳng ra DTO, không qua entity. */
export class PrismaTaskReadModel implements ITaskReadModel {
  constructor(private readonly db: DbProvider) {}

  async getTask(workspaceId: string, projectId: string, taskId: string): Promise<TaskDto | null> {
    const rows = await this.db().$queryRaw<TaskRow[]>(
      selectTasks(workspaceId, projectId, Prisma.sql`t.id = ${taskId}::uuid`),
    );
    return rows[0] ? taskDtoOfRow(rows[0]) : null;
  }

  async listTasks(
    workspaceId: string,
    projectId: string,
    filter: TaskListFilter,
    cursor: TaskListKey | null,
    limit: number,
  ): Promise<TaskDto[]> {
    const after = keyset(filter, cursor);
    if (after === null) return [];
    const conditions = [after];
    if (filter.status) conditions.push(Prisma.sql`t.status = ${status(filter.status)}`);
    if (filter.assigneeId === 'none') conditions.push(Prisma.sql`t.assignee_id IS NULL`);
    else if (filter.assigneeId !== undefined)
      conditions.push(Prisma.sql`t.assignee_id = ${filter.assigneeId}::uuid`);
    const rows = await this.db().$queryRaw<TaskRow[]>(Prisma.sql`
      ${selectTasks(workspaceId, projectId, Prisma.join(conditions, ' AND '))}
      ORDER BY t.status, t.rank, t.id
      LIMIT ${limit}`);
    return rows.map(taskDtoOfRow);
  }

  async taskExists(workspaceId: string, projectId: string, taskId: string): Promise<boolean> {
    const row = await this.db().task.findFirst({
      where: { ...scoped(workspaceId, projectId), id: taskId },
      select: { id: true },
    });
    return row !== null;
  }

  /** Mới nhất trước, phá hòa bằng id giảm dần (index `(task_id, created_at DESC, id DESC)`). */
  async listAuditLogs(
    workspaceId: string,
    projectId: string,
    taskId: string,
    cursor: AuditLogKey | null,
    limit: number,
  ): Promise<AuditLogDto[]> {
    const at = cursor ? new Date(cursor.createdAt) : null;
    const rows = await this.db().taskAuditLog.findMany({
      where: {
        taskId,
        workspaceId,
        projectId,
        ...(at && cursor
          ? { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        taskId: true,
        action: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
        actor: USER_REF,
      },
    });
    return rows.map((r) => ({
      ...r,
      oldValue: r.oldValue as AuditLogDto['oldValue'],
      newValue: r.newValue as AuditLogDto['newValue'],
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
