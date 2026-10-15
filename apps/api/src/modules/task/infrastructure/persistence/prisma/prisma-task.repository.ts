import type { Task as TaskRow } from '../../../../../generated/prisma/client';
import {
  RankConflictError,
  type ITaskRepository,
  type SaveOptions,
} from '../../../application/ports/task-repository.port';
import { Task, type TaskProps } from '../../../domain/task';
import type { TaskStatus } from '../../../domain/task-status';
import { fromDateOnly, toDateOnly, uniqueConstraintOf, type DbProvider } from './db';

/** Unique partial `(project_id, status, rank) WHERE deleted_at IS NULL` (data-and-api §1.3, ADR-062). */
const RANK_CONSTRAINT = 'tasks_rank_live_key';

const toProps = (r: TaskRow): TaskProps => ({ ...r, dueDate: toDateOnly(r.dueDate) });

/** Cột ghi được khi lưu task đã có (id/workspace/project/number/createdBy bất biến). */
function mutableColumns(p: TaskProps) {
  return {
    title: p.title,
    description: p.description,
    status: p.status,
    priority: p.priority,
    rank: p.rank,
    version: p.version,
    dueDate: fromDateOnly(p.dueDate),
    assigneeId: p.assigneeId,
    deletedAt: p.deletedAt,
    updatedAt: p.updatedAt,
  };
}

/** Lỗi unique ⇒ `RankConflictError` để use case thử lại cả transaction (Postgres đã hủy tx). */
function mapRankConflict(err: unknown): never {
  if (uniqueConstraintOf(err) === RANK_CONSTRAINT) throw new RankConflictError();
  throw err;
}

/**
 * Repository Task trên Prisma 7. Mọi truy vấn có phạm vi tenant và loại workspace đã xóa mềm
 * (ADR-020, ADR-047). Rank so sánh dưới collation "C" của cột (`gt`/`lt`/`ORDER BY`).
 */
export class PrismaTaskRepository implements ITaskRepository {
  constructor(private readonly db: DbProvider) {}

  async findLive(workspaceId: string, projectId: string, taskId: string): Promise<Task | null> {
    const row = await this.db().task.findFirst({
      where: {
        id: taskId,
        projectId,
        workspaceId,
        deletedAt: null,
        project: { workspace: { deletedAt: null } },
      },
    });
    return row ? Task.reconstitute(toProps(row)) : null;
  }

  async lastRank(
    projectId: string,
    status: TaskStatus,
    excludeId?: string,
  ): Promise<string | null> {
    return this.edgeRank(projectId, status, 'desc', undefined, excludeId);
  }

  rankAfter(projectId: string, status: TaskStatus, rank: string, excludeId: string) {
    return this.edgeRank(projectId, status, 'asc', { gt: rank }, excludeId);
  }

  rankBefore(projectId: string, status: TaskStatus, rank: string, excludeId: string) {
    return this.edgeRank(projectId, status, 'desc', { lt: rank }, excludeId);
  }

  /** Khóa ghi các task trước khi bỏ gán (data-and-api §1.9) — thứ tự id cố định tránh deadlock. */
  async listAssignedForUpdate(workspaceId: string, userId: string): Promise<Task[]> {
    const locked = await this.db().$queryRaw<{ id: string }[]>`
      SELECT id FROM tasks
       WHERE workspace_id = ${workspaceId}::uuid AND assignee_id = ${userId}::uuid
         AND deleted_at IS NULL
       ORDER BY id
         FOR UPDATE`;
    if (locked.length === 0) return [];
    const rows = await this.db().task.findMany({
      where: { id: { in: locked.map((r) => r.id) } },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => Task.reconstitute(toProps(r)));
  }

  async add(task: Task): Promise<void> {
    const p = task.toPrimitives();
    await this.db()
      .task.create({
        data: {
          id: p.id,
          workspaceId: p.workspaceId,
          projectId: p.projectId,
          number: p.number,
          createdById: p.createdById,
          createdAt: p.createdAt,
          ...mutableColumns(p),
        },
      })
      .catch(mapRankConflict);
  }

  /**
   * ADR-010 + T-028 L1/L2: một câu `UPDATE … WHERE id AND project_id AND workspace_id AND version
   * AND EXISTS(project chưa archive, ws chưa xóa)`. Điều kiện archive nằm TRONG câu UPDATE nên
   * archive đã commit trước đó luôn được thấy (READ COMMITTED đánh giá lại khi ghi).
   */
  async save(task: Task, expectedVersion: number, opts: SaveOptions = {}): Promise<boolean> {
    const p = task.toPrimitives();
    const { count } = await this.db()
      .task.updateMany({
        where: {
          id: p.id,
          projectId: p.projectId,
          workspaceId: p.workspaceId,
          version: expectedVersion,
          project: {
            workspace: { deletedAt: null },
            ...(opts.allowArchivedProject ? {} : { archivedAt: null }),
          },
        },
        data: mutableColumns(p),
      })
      .catch(mapRankConflict);
    return count === 1;
  }

  private async edgeRank(
    projectId: string,
    status: TaskStatus,
    order: 'asc' | 'desc',
    bound: { gt: string } | { lt: string } | undefined,
    excludeId: string | undefined,
  ): Promise<string | null> {
    const row = await this.db().task.findFirst({
      where: {
        projectId,
        status,
        deletedAt: null,
        ...(bound ? { rank: bound } : {}),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: [{ rank: order }, { id: order }],
      select: { rank: true },
    });
    return row?.rank ?? null;
  }
}
