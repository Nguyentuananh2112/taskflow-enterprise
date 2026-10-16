import type { MembershipSnapshot } from '../../domain/membership';
import type { ProjectSnapshot } from '../../domain/project';
import type { MemberGrant, WorkspaceRole } from '../../domain/roles';
import type { WorkspaceSnapshot } from '../../domain/workspace';

/** Phân trang keyset: `after` = id của phần tử cuối trang trước (presentation mã hóa thành cursor). */
export interface PageRequest {
  after?: string | undefined;
  limit: number;
}

export interface Page<T> {
  items: T[];
  /** id của phần tử cuối nếu còn trang sau, ngược lại `null`. */
  nextAfter: string | null;
}

export interface MemberRow extends MembershipSnapshot {
  email: string;
  fullName: string;
}

/** Phía đọc (CQRS-lite, ADR-015): bản Prisma dùng `select` trực tiếp, kể cả JOIN bảng users. */
export interface IWorkspaceQueries {
  /**
   * Workspace chưa xóa mà user là thành viên, kèm role. Tối đa 100 (data-and-api 2.5). `joinedAt` = đầu
   * nhiệm kỳ HIỆN TẠI (T-040b: chuông không hiện thông báo của nhiệm kỳ trước).
   */
  listActiveForUser(
    userId: string,
  ): Promise<
    { workspace: WorkspaceSnapshot; role: WorkspaceRole; grants: MemberGrant[]; joinedAt: Date }[]
  >;
  /** Đã xóa mềm, `purge_at > now`, user là OWNER (`?deleted=true`, security.md 3.6). */
  listDeletedOwnedBy(userId: string, now: Date): Promise<WorkspaceSnapshot[]>;
  /**
   * Thành viên của ĐÚNG workspace này; `q` (đã trim, không rỗng) khớp tên hoặc email, không phân
   * biệt hoa thường, ký tự `%`/`_`/`\` theo nghĩa đen (security.md 6.7). Sắp theo joinedAt, id.
   */
  listMembers(workspaceId: string, q: string | null, page: PageRequest): Promise<Page<MemberRow>>;
  listProjects(
    workspaceId: string,
    archived: 'false' | 'true' | 'all',
    page: PageRequest,
  ): Promise<Page<ProjectSnapshot>>;
}
