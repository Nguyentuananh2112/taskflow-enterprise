// Port do module Task ĐỊNH NGHĨA (DIP, ADR-093). Bản Prisma đọc thẳng bảng projects/
// workspace_members/users (chỉ đọc, trừ bộ đếm số task) — không import nội bộ module khác.
import type { RealtimeEventMeta, TaskRole } from '../task-actor';

export interface ProjectRef {
  id: string;
  workspaceId: string;
  keyPrefix: string;
  isArchived: boolean;
}

/** Tham số object có tên cho port liên module (3 chuỗi theo vị trí dễ truyền nhầm). */
export interface ProjectKey {
  workspaceId: string;
  projectId: string;
}

export interface ITaskProjectStore {
  /** Project thuộc workspace (workspace chưa xóa mềm). Ngoài phạm vi ⇒ `null` (404, ADR-020). */
  findInWorkspace(input: ProjectKey): Promise<ProjectRef | null>;
  /**
   * Cấp số TF-n nguyên tử (data-and-api §1.2): `UPDATE projects SET next_task_number = +1 …
   * WHERE id AND workspace_id AND archived_at IS NULL RETURNING`. `null` ⇒ không khớp (vừa bị
   * archive song song) — use case đọc lại để phân biệt.
   */
  allocateTaskNumber(input: ProjectKey): Promise<number | null>;
}

/**
 * Role hiện tại của user trong workspace, `null` nếu không phải thành viên hoặc user đã ẩn danh
 * hóa. Bản Prisma: `SELECT role … FOR SHARE` để xếp hàng với hạ role/xóa thành viên (§1.9).
 */
export interface IAssigneeDirectory {
  roleOf(input: { workspaceId: string; userId: string }): Promise<TaskRole | null>;
}

export interface UserRef {
  id: string;
  fullName: string;
}

/** Tên hiển thị cho `TaskDto.assignee/createdBy` và `AuditLogDto.actor` (user ẩn danh vẫn có tên). */
export interface IUserRefReader {
  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, UserRef>>;
}

/** Sinh rank giữa hai khóa (`fractional-indexing`); `null` = đầu/cuối cột. */
export interface IRankGenerator {
  between(before: string | null, after: string | null): string;
  /** `n` khóa tăng dần, cách đều, ngắn nhất có thể — dùng khi cân bằng lại cột (T-033). */
  spread(n: number): string[];
}

/**
 * Phát event vào phòng `project:{id}` — khớp cấu trúc `RealtimeGateway.emitToProject` (T-016).
 * CHỈ gọi trong `uow.afterCommit` (ADR-012).
 */
export interface ITaskRealtimeNotifier {
  emitToProject(
    input: { projectId: string; type: string; data: unknown },
    meta: RealtimeEventMeta,
  ): Promise<void>;
}
