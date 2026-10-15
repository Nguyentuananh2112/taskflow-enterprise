import type { AuditLogDto, TaskDto } from '@taskflow/contracts';

import type {
  AuditLogKey,
  ITaskReadModel,
  TaskListFilter,
  TaskListKey,
} from '../../../application/ports/task-read-model.port';
import { toTaskDto } from '../../../application/task-dto';
import { Task, type TaskProps } from '../../../domain/task';
import { TASK_STATUSES } from '../../../domain/task-status';
import type { InMemoryUserRefReader } from './in-memory-task-collaborators';
import type { InMemoryTaskDatabase } from './in-memory-task-database';

const byte = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (t: TaskListKey) => TASK_STATUSES.indexOf(t.status);
const compareTask = (a: TaskListKey, b: TaskListKey) =>
  order(a) - order(b) || byte(a.rank, b.rank) || byte(a.id, b.id);

/** Phía đọc InMemory: cùng thứ tự sắp và luật lọc với câu SQL của bản Prisma. */
export class InMemoryTaskReadModel implements ITaskReadModel {
  constructor(
    private readonly db: InMemoryTaskDatabase,
    private readonly users: InMemoryUserRefReader,
  ) {}

  async getTask(workspaceId: string, projectId: string, taskId: string): Promise<TaskDto | null> {
    const row = this.scoped(workspaceId, projectId).find((t) => t.id === taskId && !t.deletedAt);
    return row ? this.dto(row) : null;
  }

  async listTasks(
    workspaceId: string,
    projectId: string,
    filter: TaskListFilter,
    after: TaskListKey | null,
    limit: number,
  ): Promise<TaskDto[]> {
    const rows = this.scoped(workspaceId, projectId)
      .filter((t) => t.deletedAt === null)
      .filter((t) => !filter.status || t.status === filter.status)
      .filter((t) =>
        filter.assigneeId === undefined
          ? true
          : filter.assigneeId === 'none'
            ? t.assigneeId === null
            : t.assigneeId === filter.assigneeId,
      )
      .sort(compareTask)
      .filter((t) => !after || compareTask(t, after) > 0)
      .slice(0, limit);
    return Promise.all(rows.map((r) => this.dto(r)));
  }

  taskExists(workspaceId: string, projectId: string, taskId: string): Promise<boolean> {
    return Promise.resolve(this.scoped(workspaceId, projectId).some((t) => t.id === taskId));
  }

  async listAuditLogs(
    taskId: string,
    after: AuditLogKey | null,
    limit: number,
  ): Promise<AuditLogDto[]> {
    const key = (a: { createdAt: Date; id: string }) => ({
      c: a.createdAt.toISOString(),
      id: a.id,
    });
    const desc = (a: { c: string; id: string }, b: { c: string; id: string }) =>
      byte(b.c, a.c) || byte(b.id, a.id);
    const rows = this.db.state.audit
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => desc(key(a), key(b)))
      .filter((a) => !after || desc(key(a), { c: after.createdAt, id: after.id }) > 0)
      .slice(0, limit);
    const refs = await this.users.findRefs(rows.map((r) => r.actorId));
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      action: r.action,
      actor: refs.get(r.actorId) ?? { id: r.actorId, fullName: '' },
      oldValue: r.oldValue,
      newValue: r.newValue,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private scoped(workspaceId: string, projectId: string): TaskProps[] {
    if (!this.db.liveProject(workspaceId, projectId)) return [];
    return [...this.db.state.tasks.values()].filter(
      (t) => t.workspaceId === workspaceId && t.projectId === projectId,
    );
  }

  private async dto(row: TaskProps): Promise<TaskDto> {
    const project = this.db.state.projects.get(row.projectId);
    const ids = [row.assigneeId, row.createdById].filter((id): id is string => id !== null);
    return toTaskDto(
      Task.reconstitute(row),
      project?.keyPrefix ?? '',
      await this.users.findRefs(ids),
    );
  }
}
