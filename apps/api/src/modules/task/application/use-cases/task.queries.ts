import type { AuditLogDto, PageMeta, TaskDto } from '@taskflow/contracts';
import * as z from 'zod';

import { ResourceNotFoundError } from '../../../../core/errors';
import { decodeCursor, encodeCursor } from '../../../../core/http/cursor';
import { TASK_STATUSES } from '../../domain/task-status';
import type { ITaskProjectStore } from '../ports/collaborators.port';
import type {
  AuditLogKey,
  ITaskReadModel,
  TaskListFilter,
  TaskListKey,
} from '../ports/task-read-model.port';
import type { TaskScope } from '../task-actor';
import type { TaskPolicy } from '../task.policy';

export interface Page<T> {
  items: T[];
  page: PageMeta;
}

export interface TaskQueryDeps {
  readModel: ITaskReadModel;
  projects: ITaskProjectStore;
  policy: TaskPolicy;
}

// `kind` gắn cursor với endpoint — cursor của audit-logs dùng ở list task ⇒ 400 (UC-LS08).
const TASKS_CURSOR = 'tasks';
const AUDIT_CURSOR = 'task-audit-logs';
// Khóa cursor đi thẳng vào câu SQL (cột @db.Uuid) ⇒ validate chặt: id không phải uuid phải ra 400,
// không phải 500 từ Postgres (T-028 L4). Rank giới hạn độ dài như mọi đầu vào.
const RANK_MAX = 1024;
const TaskKeySchema = z.object({
  status: z.enum(TASK_STATUSES),
  rank: z.string().min(1).max(RANK_MAX),
  id: z.uuid(),
});
const AuditKeySchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

/** Lấy `limit + 1` dòng để biết còn trang sau; cursor = khóa của dòng cuối trang (opaque). */
async function paginate<T, K extends Record<string, unknown>>(
  limit: number,
  fetch: (n: number) => Promise<T[]>,
  keyOf: (item: T) => K,
  kind: string,
): Promise<Page<T>> {
  const rows = await fetch(limit + 1);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  const nextCursor = hasMore && last ? encodeCursor(kind, { ...keyOf(last) }) : null;
  return { items, page: { nextCursor, hasMore, limit } };
}

/** CQRS-lite (ADR-015): truy vấn đọc trả DTO thẳng; vẫn kiểm phạm vi tenant (ADR-020 lớp 2). */
export class TaskQueries {
  constructor(private readonly d: TaskQueryDeps) {}

  /** `GET …/tasks/:taskId` — task đã xóa mềm ⇒ 404 (R16). */
  async getTask(scope: TaskScope & { taskId: string }): Promise<TaskDto> {
    await this.assertReadable(scope, 'task:read');
    const task = await this.d.readModel.getTask(scope.workspaceId, scope.projectId, scope.taskId);
    if (!task) throw new ResourceNotFoundError('task');
    return task;
  }

  /** `GET …/tasks` — sắp theo status (thứ tự enum), rank, id; không có task đã xóa. */
  async listTasks(
    scope: TaskScope & { query: TaskListFilter & { cursor?: string; limit: number } },
  ): Promise<Page<TaskDto>> {
    await this.assertReadable(scope, 'task:read');
    const { cursor, limit, ...filter } = scope.query;
    const after: TaskListKey | null = cursor
      ? decodeCursor(cursor, TASKS_CURSOR, TaskKeySchema)
      : null;
    return paginate(
      limit,
      (n) => this.d.readModel.listTasks(scope.workspaceId, scope.projectId, filter, after, n),
      (t) => ({ status: t.status, rank: t.rank, id: t.id }),
      TASKS_CURSOR,
    );
  }

  /** `GET …/tasks/:taskId/audit-logs` — mới nhất trước; task đã xóa mềm vẫn đọc được (R16). */
  async listAuditLogs(
    scope: TaskScope & { taskId: string; query: { cursor?: string; limit: number } },
  ): Promise<Page<AuditLogDto>> {
    await this.assertReadable(scope, 'audit:read');
    const exists = await this.d.readModel.taskExists(
      scope.workspaceId,
      scope.projectId,
      scope.taskId,
    );
    if (!exists) throw new ResourceNotFoundError('task');
    const { cursor, limit } = scope.query;
    const after: AuditLogKey | null = cursor
      ? decodeCursor(cursor, AUDIT_CURSOR, AuditKeySchema)
      : null;
    return paginate(
      limit,
      (n) =>
        this.d.readModel.listAuditLogs(scope.workspaceId, scope.projectId, scope.taskId, after, n),
      (a) => ({ createdAt: a.createdAt, id: a.id }),
      AUDIT_CURSOR,
    );
  }

  private async assertReadable(scope: TaskScope, permission: 'task:read' | 'audit:read') {
    const project = await this.d.projects.findInWorkspace({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });
    if (!project) throw new ResourceNotFoundError('project');
    this.d.policy.assert(this.d.policy.can(scope.actor, permission), permission);
  }
}
