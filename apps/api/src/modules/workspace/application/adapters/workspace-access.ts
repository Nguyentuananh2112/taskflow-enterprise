import { ResourceNotFoundError } from '../../../../core/errors';
import type { IMembershipRepository, IWorkspaceRepository } from '../ports/repositories.port';
import type { Actor } from '../workspace-shared';

/**
 * Lõi của middleware `loadMembership` (security.md 3.3) — presentation ở ticket sau chỉ gọi hàm
 * này. Không phải member, ws không tồn tại, hoặc ws đã xóa mềm ⇒ CÙNG một `404 workspace`
 * (ADR-020, ADR-047). Đọc DB mỗi request, không cache (đổi role/xóa member có hiệu lực ngay).
 */
export class WorkspaceAccess {
  constructor(
    private readonly d: { workspaces: IWorkspaceRepository; memberships: IMembershipRepository },
  ) {}

  async resolveActor(workspaceId: string, userId: string): Promise<Actor> {
    const [workspace, membership] = await Promise.all([
      this.d.workspaces.findById(workspaceId),
      this.d.memberships.find(workspaceId, userId),
    ]);
    if (!workspace || workspace.isDeleted || !membership)
      throw new ResourceNotFoundError('workspace');
    // ADR-119 / GR-11: grants đến từ CÙNG dòng membership vừa đọc — không thêm truy vấn, không cache.
    return { userId, workspaceId, role: membership.role, grants: [...membership.grants] };
  }
}
