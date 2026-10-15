import type { IMembershipReader, MembershipView } from '../../../auth';
import type { IWorkspaceQueries } from '../ports/queries.port';

/** Hiện thực `IMembershipReader` của auth cho `GET /auth/me` — đã loại ws xóa mềm (ADR-047). */
export class WorkspaceMembershipReader implements IMembershipReader {
  constructor(private readonly d: { queries: IWorkspaceQueries }) {}

  async listForUser(userId: string): Promise<MembershipView[]> {
    const rows = await this.d.queries.listActiveForUser(userId);
    return rows.map(({ workspace, role }) => ({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      slug: workspace.slug,
      role,
    }));
  }
}
