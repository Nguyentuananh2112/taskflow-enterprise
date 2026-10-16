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
  /**
   * Khóa ghi rank của một cột tới hết transaction (T-033): `pg_advisory_xact_lock` theo
   * `(project, status)`. Mọi lệnh tính rank từ hàng xóm (create, move) và rebalance đều lấy khóa
   * này TRƯỚC khi đọc hàng xóm ⇒ không tính rank theo dữ liệu cột đang được tính lại.
   */
  lockColumn(projectId: string, status: TaskStatus): Promise<void>;
  /** Task sống của cột, theo `rank, id` (collation "C"). Gọi sau `lockColumn`. */
  listColumn(projectId: string, status: TaskStatus): Promise<Task[]>;
  /**
   * Pha 1 của rebalance: đổi rank mọi task sống trong cột sang khóa tạm duy nhất `~<id>`
   * (không đổi version) để pha 2 ghi rank mới không va unique `tasks_rank_live_key` giữa chừng.
   * Khóa tạm chỉ tồn tại trong transaction — pha 2 ghi đè hết trước commit.
   */
  stashColumnRanks(projectId: string, status: TaskStatus): Promise<void>;
  /** Trùng `(project, status, rank)` của task sống ⇒ ném `RankConflictError` (unique partial). */
  add(task: Task): Promise<void>;
  /**
   * Ghi NGUYÊN TỬ, có điều kiện trong cùng một câu UPDATE: đúng tenant (`id` + `projectId` +
   * `workspaceId`), `version = expectedVersion` (ADR-010) và — trừ khi `allowArchivedProject` —
   * project chưa archive (ADR-023/045: archive commit trước thì câu UPDATE thấy và không ghi;
   * T-028 L1). `false` ⇒ use case đọc lại để trả 422 hoặc 409. Trùng rank ⇒ `RankConflictError`.
   * `allowArchivedProject` chỉ cho bỏ gán do hệ thống (ADR-092).
   */
  save(task: Task, expectedVersion: number, opts?: SaveOptions): Promise<boolean>;
  /**
   * Pha 2 của rebalance (A3): ghi `rank`/`version`/`updatedAt` của nhiều task trong MỘT câu UPDATE
   * theo lô. Mỗi dòng giữ đủ điều kiện của `save` (tenant, `version = expectedVersion` — ADR-010/110,
   * task sống, project chưa archive, ws chưa xóa). Trả số dòng đã ghi; dòng không khớp điều kiện bị
   * bỏ qua ⇒ caller so với số dòng gửi lên rồi hủy transaction. Trùng rank ⇒ `RankConflictError`.
   */
  saveRanks(writes: readonly RankWrite[]): Promise<number>;
}

export interface RankWrite {
  task: Task;
  expectedVersion: number;
}

export interface SaveOptions {
  allowArchivedProject?: boolean;
}

/** Vi phạm unique `tasks_rank_live_key` — use case thử lại cả transaction (data-and-api §1.3). */
export class RankConflictError extends Error {
  constructor() {
    super('Trùng rank trong cột (tasks_rank_live_key).');
    this.name = 'RankConflictError';
  }
}
