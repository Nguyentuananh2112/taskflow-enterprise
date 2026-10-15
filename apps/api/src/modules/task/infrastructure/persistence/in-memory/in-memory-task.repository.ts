import {
  RankConflictError,
  type ITaskRepository,
  type SaveOptions,
} from '../../../application/ports/task-repository.port';
import { Task, type TaskProps } from '../../../domain/task';
import type { TaskStatus } from '../../../domain/task-status';
import type { InMemoryTaskDatabase } from './in-memory-task-database';

/** Cùng hợp đồng với bản Prisma (LSP): phạm vi tenant, unique partial rank, ghi có điều kiện version. */
export class InMemoryTaskRepository implements ITaskRepository {
  constructor(private readonly db: InMemoryTaskDatabase) {}

  findLive(workspaceId: string, projectId: string, taskId: string): Promise<Task | null> {
    const row = this.db.state.tasks.get(taskId);
    const ok =
      row &&
      row.deletedAt === null &&
      row.projectId === projectId &&
      row.workspaceId === workspaceId &&
      this.db.liveProject(workspaceId, projectId);
    return Promise.resolve(ok ? Task.reconstitute(row) : null);
  }

  lastRank(projectId: string, status: TaskStatus, excludeId?: string): Promise<string | null> {
    return Promise.resolve(this.column(projectId, status, excludeId).at(-1) ?? null);
  }

  rankAfter(projectId: string, status: TaskStatus, rank: string, excludeId: string) {
    return Promise.resolve(this.column(projectId, status, excludeId).find((r) => r > rank) ?? null);
  }

  rankBefore(projectId: string, status: TaskStatus, rank: string, excludeId: string) {
    const lower = this.column(projectId, status, excludeId).filter((r) => r < rank);
    return Promise.resolve(lower.at(-1) ?? null);
  }

  listAssignedForUpdate(workspaceId: string, userId: string): Promise<Task[]> {
    const rows = [...this.db.state.tasks.values()].filter(
      (t) => t.workspaceId === workspaceId && t.assigneeId === userId && t.deletedAt === null,
    );
    return Promise.resolve(rows.map((r) => Task.reconstitute(r)));
  }

  add(task: Task): Promise<void> {
    const row = task.toPrimitives();
    const project = this.db.state.projects.get(row.projectId);
    // Mô phỏng FK kép (D6) + unique (project, number) + unique partial rank.
    if (!project || project.workspaceId !== row.workspaceId) {
      return Promise.reject(new Error('FK tasks(project_id, workspace_id) bị vi phạm'));
    }
    if (
      [...this.db.state.tasks.values()].some(
        (t) => t.projectId === row.projectId && t.number === row.number,
      )
    ) {
      return Promise.reject(new Error('Unique (project_id, number) bị vi phạm'));
    }
    if (this.rankTaken(row)) return Promise.reject(new RankConflictError());
    this.db.state.tasks.set(row.id, row);
    return Promise.resolve();
  }

  save(task: Task, expectedVersion: number, opts: SaveOptions = {}): Promise<boolean> {
    const row = task.toPrimitives();
    const current = this.db.state.tasks.get(task.id);
    const project = this.db.liveProject(row.workspaceId, row.projectId);
    const matches =
      current !== undefined &&
      current.projectId === row.projectId &&
      current.workspaceId === row.workspaceId &&
      current.version === expectedVersion &&
      project !== undefined &&
      (opts.allowArchivedProject === true || project.archivedAt === null);
    if (!matches) return Promise.resolve(false);
    if (this.rankTaken(row)) return Promise.reject(new RankConflictError());
    this.db.state.tasks.set(row.id, row);
    return Promise.resolve(true);
  }

  private rankTaken(row: TaskProps): boolean {
    if (row.deletedAt !== null) return false;
    return [...this.db.state.tasks.values()].some(
      (t) =>
        t.id !== row.id &&
        t.deletedAt === null &&
        t.projectId === row.projectId &&
        t.status === row.status &&
        t.rank === row.rank,
    );
  }

  /** Rank của task sống trong cột, tăng dần theo byte (collation "C"). */
  private column(projectId: string, status: TaskStatus, excludeId?: string): string[] {
    return [...this.db.state.tasks.values()]
      .filter(
        (t) =>
          t.projectId === projectId &&
          t.status === status &&
          t.deletedAt === null &&
          t.id !== excludeId,
      )
      .map((t) => t.rank)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
}
