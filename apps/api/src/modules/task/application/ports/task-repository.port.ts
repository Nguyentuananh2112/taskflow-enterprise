import type { Task } from '../../domain/task';
import type { TaskStatus } from '../../domain/task-status';

/**
 * Lưu trữ aggregate Task. Mọi truy vấn **có phạm vi tenant** (data-and-api §2.2): luôn nhận
 * `workspaceId` + `projectId`, không có `findById` trần.
 */
export interface ITaskRepository {
  /** Task chưa xóa mềm thuộc đúng project ∈ workspace; ngoài phạm vi / đã xóa ⇒ `null` (404). */
  findLive(workspaceId: string, projectId: string, taskId: string): Promise<Task | null>;
  /** Rank lớn nhất trong cột (task chưa xóa) — task mới/move không anchor vào cuối cột. */
  lastRank(projectId: string, status: TaskStatus, excludeId?: string): Promise<string | null>;
  /** Rank liền sau / liền trước `rank` trong cột, bỏ qua `excludeId` (chính task đang move). */
  rankAfter(
    projectId: string,
    status: TaskStatus,
    rank: string,
    excludeId: string,
  ): Promise<string | null>;
  rankBefore(
    projectId: string,
    status: TaskStatus,
    rank: string,
    excludeId: string,
  ): Promise<string | null>;
  /**
   * Task chưa xóa của `userId` trong workspace, mọi project (kể cả archived — ADR-092).
   * Bản Prisma: `SELECT … FOR UPDATE` (data-and-api §1.9).
   */
  listAssignedForUpdate(workspaceId: string, userId: string): Promise<Task[]>;
  /** Trùng `(project, status, rank)` của task sống ⇒ ném `RankConflictError` (unique partial). */
  add(task: Task): Promise<void>;
  /**
   * Ghi có điều kiện `version = expectedVersion` (ADR-010: `updateMany`). `false` ⇒ có ghi khác
   * lọt vào giữa ⇒ use case trả 409. Trùng rank ⇒ `RankConflictError`.
   */
  save(task: Task, expectedVersion: number): Promise<boolean>;
}

/** Vi phạm unique `tasks_rank_live_key` — use case thử lại cả transaction (data-and-api §1.3). */
export class RankConflictError extends Error {
  constructor() {
    super('Trùng rank trong cột (tasks_rank_live_key).');
    this.name = 'RankConflictError';
  }
}
