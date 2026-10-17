// Port do module Workspace ĐỊNH NGHĨA; bên khác hiện thực, wire ở composition root (ADR-093).
import type { WorkspaceRole } from '../../domain/roles';

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
}

/**
 * Tra user để thêm thành viên. Bản Prisma đọc bảng `users` (chỉ đọc) — không gọi qua module auth.
 * `email` truyền vào đã chuẩn hóa (trim, NFC, lowercase). User đã xóa/ẩn danh hóa ⇒ `null`.
 */
export interface IUserDirectory {
  findByEmail(normalizedEmail: string): Promise<UserSummary | null>;
  findById(id: string): Promise<UserSummary | null>;
}

/**
 * Bỏ gán mọi task (chưa xóa mềm, kể cả trong project archived — ADR-092) của `userId` trong
 * workspace, mỗi task `version + 1` + audit `ASSIGNEE_CHANGED` với actor; gọi TRONG transaction
 * (ADR-044, R14). Event `task:*` do module Task phát sau commit. Module Task hiện thực.
 */
export interface ITaskAssignmentCleaner {
  /**
   * Chữ ký theo test-spec-task.md §3.3 (ADR-090), chốt với C (T-018). Tham số object có tên:
   * 3 chuỗi theo vị trí dễ truyền nhầm thứ tự (quy tắc Tech Lead cho port liên module).
   */
  unassignAllForUser(input: {
    workspaceId: string;
    userId: string;
    actorId: string;
  }): Promise<{ unassignedTaskCount: number }>;
}

/** Chốt với A (T-016): vỏ event chung cần actorId; originClientId = X-Client-Id hợp lệ hoặc null. */
export interface RealtimeEventMeta {
  actorId: string;
  originClientId?: string | null;
}

/**
 * Gateway Socket.io (T-016) hiện thực — CHỈ gọi trong `uow.afterCommit` (ADR-012). Tham số object
 * có tên (quy tắc Tech Lead: port liên module có ≥ 2 tham số cùng kiểu).
 */
export interface IWorkspaceRealtimeNotifier {
  revokeWorkspaceAccess(
    input: { userId: string; workspaceId: string; projectIds: string[] },
    meta: RealtimeEventMeta,
  ): Promise<void>;
  notifyRoleChanged(
    input: { userId: string; workspaceId: string; role: WorkspaceRole },
    meta: RealtimeEventMeta,
  ): Promise<void>;
  closeWorkspace(
    input: { workspaceId: string; projectIds: string[]; memberUserIds: string[] },
    meta: RealtimeEventMeta,
  ): Promise<void>;
  /**
   * `project:updated` (data-and-api §615) tới phòng `project:{id}` sau update / archive / unarchive
   * — FE khóa board khi `isArchived`. Gateway dựng envelope; `data.project` đúng `ProjectDto`.
   */
  emitToProject(
    input: { projectId: string; type: 'project:updated'; data: { project: ProjectEventDto } },
    meta: RealtimeEventMeta,
  ): Promise<void>;
}

/**
 * Mốc 3.5 (ADR-135, B HIGH-2): người gọi còn thuộc công ty VÀ chưa quá `offboard_access_until`. `loadMembership`
 * (HTTP) và `project:join` (socket) đều đi qua `WorkspaceAccess` ⇒ hết quyền đúng giờ ở mọi cửa của workspace.
 * Composition nối module company (ADR-093: workspace không import company).
 */
export interface ICompanyMembershipGate {
  isActive(userId: string): Promise<boolean>;
  /**
   * Thêm được vào workspace (ADR-134): thuộc công ty (nhân viên hoặc Admin, kể cả chờ kích hoạt) và CHƯA có lịch
   * nghỉ việc. Sai ⇒ 422 `NOT_ACTIVE_MEMBER`.
   */
  canJoinWorkspace(userId: string): Promise<boolean>;
}

export interface MemberCandidate {
  id: string;
  fullName: string;
  email: string;
}

/**
 * Danh bạ người thêm được vào workspace (`member-candidates`, ADR-134, R41) — đúng điều kiện của
 * `canJoinWorkspace`, chưa là thành viên `workspaceId`; `q` khớp tên hoặc email không phân biệt hoa thường,
 * `%`/`_`/`\` theo nghĩa đen (security.md 6.7). Sắp theo (tên, id), tối đa `limit`. Chỉ id + tên + email.
 */
export interface IMemberCandidateDirectory {
  search(input: { workspaceId: string; q: string; limit: number }): Promise<MemberCandidate[]>;
}

/** `ProjectDto` (contracts) dạng truyền qua socket — ngày là chuỗi ISO. */
export interface ProjectEventDto {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  description: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Chốt với A (T-016) — `core/realtime` của A định nghĩa; Workspace hiện thực. */
export interface IProjectAccessChecker {
  canAccessProject(input: {
    userId: string;
    workspaceId: string;
    projectId: string;
  }): Promise<boolean>;
}

/**
 * Xóa cứng một workspace hết hạn ân hạn (ADR-095). Bản Prisma: chạy trong transaction, giữ
 * `pg_try_advisory_xact_lock`, khóa dòng, KIỂM LẠI `purge_at <= now` (có thể vừa được khôi phục),
 * xóa theo lô (audit → task → workspace cascade). `false` = bỏ qua (đã khôi phục/không còn).
 */
export interface IWorkspacePurger {
  purge(workspaceId: string, now: Date): Promise<boolean>;
}
