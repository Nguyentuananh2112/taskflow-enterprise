import type { Membership } from '../../domain/membership';
import type { Project } from '../../domain/project';
import type { Workspace } from '../../domain/workspace';

/**
 * Hợp đồng chung cho mọi repository của module (bản Prisma ở ticket sau phải tuân theo):
 * - Truy vấn tài nguyên tenant LUÔN có `workspaceId` (ADR-020) — không có `findById` trần cho
 *   project/membership.
 * - Vi phạm unique ⇒ `ResourceConflictError({ reason: 'taken', field })` (slug, keyPrefix) hoặc
 *   `ResourceConflictError({ reason: 'already_member' })`.
 * - ADR-110: KHÔNG có ghi snapshot không điều kiện. `save` của Workspace/Project là
 *   `UPDATE … WHERE id AND version = <version đã đọc> AND <chưa xóa>` rồi `version + 1`; trả `false`
 *   khi không khớp (ghi đồng thời / đã xóa) — use case đọc lại để chọn 404 hay 409.
 */
export interface IWorkspaceRepository {
  /** Trả cả workspace đã xóa mềm — use case quyết định 404. */
  findById(id: string): Promise<Workspace | null>;
  add(workspace: Workspace): Promise<void>;
  /** ADR-110: có điều kiện `version` + `deleted_at IS NULL`; `false` ⇒ không ghi gì. */
  save(workspace: Workspace): Promise<boolean>;
  /**
   * `UPDATE … SET deleted_at = NULL, purge_at = NULL, deleted_by_id = NULL WHERE id = ? AND
   * deleted_at IS NOT NULL AND purge_at > now` — `false` khi không thỏa (đã purge/quá hạn/chưa xóa).
   */
  restoreIfWithinGrace(id: string, now: Date): Promise<boolean>;
  /** Id workspace có `purge_at <= now`, tối đa `limit` (job purge, ADR-095). */
  listPurgeable(now: Date, limit: number): Promise<string[]>;
}

export interface IMembershipRepository {
  find(workspaceId: string, userId: string): Promise<Membership | null>;
  add(membership: Membership): Promise<void>;
  save(membership: Membership): Promise<void>;
  remove(workspaceId: string, userId: string): Promise<void>;
  /**
   * ADR-046: `SELECT user_id … WHERE workspace_id = ? AND role = 'OWNER' ORDER BY id FOR UPDATE`
   * — gọi TRONG transaction, TRƯỚC khi đọc/đổi dòng mục tiêu. Trả userId của các OWNER.
   */
  lockOwners(workspaceId: string): Promise<string[]>;
  listUserIds(workspaceId: string): Promise<string[]>;
  /**
   * Mốc 3 (B-H3a): đọc membership + khóa dòng `FOR SHARE` — gọi TRONG transaction. UPDATE dòng đó
   * (thu grant, đổi role) song song phải chờ ta commit và ngược lại. InMemory: như `find`.
   */
  findForShare(workspaceId: string, userId: string): Promise<Membership | null>;
}

export interface IProjectRepository {
  findInWorkspace(workspaceId: string, projectId: string): Promise<Project | null>;
  add(project: Project): Promise<void>;
  /**
   * ADR-110: có điều kiện `version` + workspace chưa xóa; không ghi `next_task_number`.
   * `false` ⇒ không ghi gì.
   */
  save(project: Project): Promise<boolean>;
  /** MỌI project của ws, kể cả archived (socket: rời mọi phòng). */
  listIds(workspaceId: string): Promise<string[]>;
}
