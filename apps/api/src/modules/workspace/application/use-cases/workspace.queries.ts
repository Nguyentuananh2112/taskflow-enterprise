import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError } from '../../../../core/errors';
import type { IWorkspaceQueries } from '../ports/queries.port';
import type { IWorkspaceRepository } from '../ports/repositories.port';
import {
  requirePermission,
  toDeletedWorkspaceView,
  toWorkspaceView,
  type Actor,
  type DeletedWorkspaceView,
  type WorkspaceView,
} from '../workspace-shared';

/** `GET /workspaces[?deleted=true]` — lọc theo userId, không có wsId (security.md 3.4). */
export class ListMyWorkspacesQuery {
  constructor(private readonly d: { queries: IWorkspaceQueries; clock: IClock }) {}

  async execute(input: { userId: string; deleted: false }): Promise<WorkspaceView[]>;
  async execute(input: { userId: string; deleted: true }): Promise<DeletedWorkspaceView[]>;
  async execute(input: {
    userId: string;
    deleted: boolean;
  }): Promise<WorkspaceView[] | DeletedWorkspaceView[]> {
    if (input.deleted) {
      const rows = await this.d.queries.listDeletedOwnedBy(input.userId, this.d.clock.now());
      return rows.map(toDeletedWorkspaceView);
    }
    const rows = await this.d.queries.listActiveForUser(input.userId);
    return rows.map(({ workspace, role }) => toWorkspaceView(workspace, role));
  }
}

/** `GET /workspaces/:wsId`. */
export class GetWorkspaceQuery {
  constructor(private readonly d: { workspaces: IWorkspaceRepository }) {}

  async execute(actor: Actor): Promise<WorkspaceView> {
    requirePermission(actor, 'workspace:read');
    const ws = await this.d.workspaces.findById(actor.workspaceId);
    if (!ws || ws.isDeleted) throw new ResourceNotFoundError('workspace');
    return toWorkspaceView(ws.toSnapshot(), actor.role);
  }
}
