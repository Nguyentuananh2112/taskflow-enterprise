import type { Task as TaskRow } from '../../../../../generated/prisma/client';
import {
  RankConflictError,
  type ITaskRepository,
  type RankWrite,
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

/** Chờ khóa cột tối đa (review B T-033 F3) — đủ cho rebalance cột ≤ RANK_REBALANCE_MAX_TASKS. */
const LOCK_TIMEOUT = '2s';
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

  /** `pg_advisory_xact_lock` trả `void` — Prisma không đọc được cột void ⇒ dùng `$executeRaw`. */
  async lockColumn(projectId: string, status: TaskStatus): Promise<void> {
    // Review B T-033 F3: chờ khóa KHÔNG giới hạn ⇒ một rebalance dài làm request cùng cột giữ hết pool
    // (ảnh hưởng chéo tenant). Giới hạn chờ (cả khóa dòng sau đó trong cùng transaction) ⇒ 55P03 ⇒
    // `inTransactionWithRankRetry` chạy lại, quá giới hạn ⇒ 503.
    await this.db().$executeRaw`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`;
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`taskflow:rank:${projectId}:${status}`}, 0))`;
  }

  async listColumn(projectId: string, status: TaskStatus): Promise<Task[]> {
    const rows = await this.db().task.findMany({
      where: { projectId, status, deletedAt: null },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => Task.reconstitute(toProps(r)));
  }

  /** Một câu UPDATE: id duy nhất ⇒ `~<id>` duy nhất, không va unique; version giữ nguyên. */
  async stashColumnRanks(projectId: string, status: TaskStatus): Promise<void> {
    await this.db().$executeRaw`
      UPDATE tasks SET rank = '~' || id::text
       WHERE project_id = ${projectId}::uuid AND status = ${status}::"TaskStatus" AND deleted_at IS NULL`;
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

  /**
   * A3: một câu `UPDATE … FROM (VALUES …)` thay cho N lệnh `save` (T-027b: ~0,8 s/500 task là do
   * ~1500 lượt đi về DB, không phải SQL chậm). Điều kiện từng dòng giống hệt `save`; dòng nào lệch
   * version / đã xóa / project archive thì không được ghi ⇒ số dòng trả về nhỏ hơn số dòng gửi.
   */
  async saveRanks(writes: readonly RankWrite[]): Promise<number> {
    if (writes.length === 0) return 0;
    // `unnest` theo cột: 7 tham số mảng cho cả lô (VALUES từng dòng tốn CPU Prisma theo số tham số).
    const rows = writes.map(({ task, expectedVersion }) => ({
      p: task.toPrimitives(),
      expectedVersion,
    }));
    return this.db().$executeRaw`
      UPDATE tasks AS t
         SET rank = v.rank, version = v.version, updated_at = v.updated_at
        FROM unnest(${rows.map((r) => r.p.id)}::uuid[], ${rows.map((r) => r.p.workspaceId)}::uuid[],
                    ${rows.map((r) => r.p.projectId)}::uuid[], ${rows.map((r) => r.p.rank)}::text[],
                    ${rows.map((r) => r.p.version)}::int[], ${rows.map((r) => r.expectedVersion)}::int[],
                    ${rows.map((r) => r.p.updatedAt.toISOString())}::timestamptz[])
             AS v(id, workspace_id, project_id, rank, version, expected_version, updated_at)
       WHERE t.id = v.id AND t.workspace_id = v.workspace_id AND t.project_id = v.project_id
         AND t.version = v.expected_version AND t.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM projects p JOIN workspaces w ON w.id = p.workspace_id
                      WHERE p.id = t.project_id AND p.archived_at IS NULL AND w.deleted_at IS NULL)`.catch(
      mapRankConflict,
    );
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
