// Port do module auth ĐỊNH NGHĨA, module khác HIỆN THỰC, wire ở composition root (ADR-093).

/**
 * Register tạo workspace mặc định + membership OWNER + project mặc định (FR-01) trong **cùng
 * transaction** với user. Hiện thực bởi module Workspace.
 *
 * Slug sinh từ họ tên theo R19 (data-and-api.md 2.5): `attempt = 0` thử slug gốc, `attempt ≥ 1`
 * thêm hậu tố ngẫu nhiên. Trùng slug ⇒ ném `ResourceConflictError` với `details.field = 'slug'`;
 * Register thử lại **cả transaction** (lỗi unique làm hỏng transaction Postgres).
 * Không nhận email — slug không bao giờ lộ email (REG-13).
 */
export interface IWorkspaceProvisioner {
  provisionDefault(input: {
    ownerId: string;
    ownerFullName: string;
    attempt: number;
  }): Promise<{ workspaceId: string }>;
}

export interface MembershipView {
  workspaceId: string;
  workspaceName: string;
  slug: string;
  role: 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER';
}

/** `GET /auth/me`: membership của user, đã loại workspace xóa mềm (ADR-047). Module Workspace hiện thực. */
export interface IMembershipReader {
  listForUser(userId: string): Promise<MembershipView[]>;
}

/** Ngắt socket (security.md 5.4). Gateway Socket.io hiện thực ở Phase 3; chỉ gọi SAU commit. */
export interface IAuthRealtimeNotifier {
  disconnectSession(sid: string): Promise<void>;
  disconnectUser(userId: string): Promise<void>;
}
