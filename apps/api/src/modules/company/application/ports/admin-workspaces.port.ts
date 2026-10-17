/** Một workspace cho màn Quản trị — KHÔNG có dự án / task (company-level ADR-134). */
export interface AdminWorkspaceView {
  id: string;
  name: string;
  deletedAt: Date | null;
  archivedAt: Date | null;
  /** Chưa xóa mềm, chưa lưu trữ, 0 OWNER. */
  orphan: boolean;
  members: { userId: string; fullName: string; role: 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER' }[];
}

/**
 * Dữ liệu workspace cho Admin (T-061a) — company sở hữu, adapter ở module workspace (`AdminWorkspaceOps`), nối ở
 * composition. Lệnh ghi chạy TRONG transaction của bên gọi (đã khóa `company:admins` + chốt quyền Admin).
 */
export interface IAdminWorkspaces {
  list(): Promise<AdminWorkspaceView[]>;
  /** 404 `workspace`; 409 `workspace_deleted` / `workspace_has_owner`; 422 `NOT_WORKSPACE_MEMBER`. */
  assignOwner(q: {
    workspaceId: string;
    userId: string;
    actorId: string;
  }): Promise<AdminWorkspaceView>;
  /** 404 `workspace`; 409 `workspace_deleted` / `workspace_has_members`; đã lưu trữ ⇒ trả như cũ. */
  archive(q: { workspaceId: string }): Promise<AdminWorkspaceView>;
}
