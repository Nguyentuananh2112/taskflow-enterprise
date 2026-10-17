import type { ICompanyMembershipGate } from '../ports/collaborators.port';
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
    private readonly d: {
      workspaces: IWorkspaceRepository;
      memberships: IMembershipRepository;
      company: ICompanyMembershipGate;
    },
  ) {}

  async resolveActor(workspaceId: string, userId: string): Promise<Actor> {
    const [workspace, membership, inCompany] = await Promise.all([
      this.d.workspaces.findById(workspaceId),
      this.d.memberships.find(workspaceId, userId),
      this.d.company.isActive(userId),
    ]);
    // Người đã nghỉ việc / quá `access_until` ⇒ như người ngoài (404, ADR-020) ngay cả khi job chưa xóa membership.
    if (!workspace || workspace.isDeleted || !membership || !inCompany)
      throw new ResourceNotFoundError('workspace');
    return { userId, workspaceId, role: membership.role };
  }
}
