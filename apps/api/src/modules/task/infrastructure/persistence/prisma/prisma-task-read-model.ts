import type { AuditLogDto, TaskDto } from '@taskflow/contracts';

import type { Prisma } from '../../../../../generated/prisma/client';
import type {
  AuditLogKey,
  ITaskReadModel,
  TaskListFilter,
  TaskListKey,
} from '../../../application/ports/task-read-model.port';
import { taskKey } from '../../../application/task-dto';
import { TASK_STATUSES } from '../../../domain/task-status';
import { toDateOnly, type DbProvider } from './db';

const USER_REF = { select: { id: true, fullName: true } } as const;
const TASK_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  number: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  rank: true,
  version: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  assignee: USER_REF,
  createdBy: USER_REF,
  project: { select: { keyPrefix: true } },
} satisfies Prisma.TaskSelect;
type TaskReadRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

function toDto(r: TaskReadRow): TaskDto {
  const { project, dueDate, createdAt, updatedAt, ...rest } = r;
  return {
    ...rest,
    key: taskKey(project.keyPrefix, r.number),
    dueDate: toDateOnly(dueDate),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

/** Task ∈ project ∈ workspace chưa xóa mềm (ADR-020, ADR-047). */
const scoped = (workspaceId: string, projectId: string): Prisma.TaskWhereInput => ({
  workspaceId,
  projectId,
  project: { workspace: { deletedAt: null } },
});

/**
 * Keyset sau `(status, rank, id)`. Prisma không có `gt` cho enum ⇒ tách: các status đứng sau,
 * hoặc cùng status rank lớn hơn, hoặc cùng status + rank thì id lớn hơn. Postgres sắp enum
 * theo thứ tự khai báo, rank theo collation "C" ⇒ khớp `ORDER BY status, rank, id`.
 */
function after(key: TaskListKey | null): Prisma.TaskWhereInput {
  if (!key) return {};
  const later = TASK_STATUSES.slice(TASK_STATUSES.indexOf(key.status) + 1);
  return {
    OR: [
      { status: { in: later } },
      { status: key.status, rank: { gt: key.rank } },
      { status: key.status, rank: key.rank, id: { gt: key.id } },
    ],
  };
}

/** Phía đọc CQRS-lite (ADR-015): `select` thẳng ra DTO, không qua entity. */
export class PrismaTaskReadModel implements ITaskReadModel {
  constructor(private readonly db: DbProvider) {}

  async getTask(workspaceId: string, projectId: string, taskId: string): Promise<TaskDto | null> {
    const row = await this.db().task.findFirst({
      where: { ...scoped(workspaceId, projectId), id: taskId, deletedAt: null },
      select: TASK_SELECT,
    });
    return row ? toDto(row) : null;
  }

  async listTasks(
    workspaceId: string,
    projectId: string,
    filter: TaskListFilter,
    cursor: TaskListKey | null,
    limit: number,
  ): Promise<TaskDto[]> {
    const assignee =
      filter.assigneeId === undefined
        ? {}
        : { assigneeId: filter.assigneeId === 'none' ? null : filter.assigneeId };
    const rows = await this.db().task.findMany({
      where: {
        AND: [
          { ...scoped(workspaceId, projectId), deletedAt: null, ...assignee },
          filter.status ? { status: filter.status } : {},
          after(cursor),
        ],
      },
      orderBy: [{ status: 'asc' }, { rank: 'asc' }, { id: 'asc' }],
      take: limit,
      select: TASK_SELECT,
    });
    return rows.map(toDto);
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
