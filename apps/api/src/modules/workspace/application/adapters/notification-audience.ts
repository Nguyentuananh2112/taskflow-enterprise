import type {
  AudienceWorkspace,
  INotificationAudience,
  MemberAccess,
} from '../../../notifications';
import type { IWorkspaceQueries } from '../ports/queries.port';

/**
 * Hiện thực `INotificationAudience` của notifications (T-040b L2): membership HIỆN TẠI đọc qua phía đọc của
 * Workspace mỗi lần gọi — không cache, không tin token (B-H3b). Ws xóa mềm đã bị loại ở `listActiveForUser`.
 */
export class WorkspaceNotificationAudience implements INotificationAudience {
  constructor(private readonly d: { queries: IWorkspaceQueries }) {}

  async workspacesOf(userId: string): Promise<AudienceWorkspace[]> {
    const rows = await this.d.queries.listActiveForUser(userId);
    return rows.map(({ workspace, role, grants, joinedAt }) => ({
      userId,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      role,
      grants,
      joinedAt,
    }));
  }

  membersOf(workspaceId: string): Promise<MemberAccess[]> {
    return this.d.queries.listMemberAccess(workspaceId);
  }
}
