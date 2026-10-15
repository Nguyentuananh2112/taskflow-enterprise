import { ResourceNotFoundError } from '../../../../core/errors';
import type { IWorkspaceQueries, Page } from '../ports/queries.port';
import type { IProjectRepository } from '../ports/repositories.port';
import {
  requirePermission,
  toProjectView,
  type Actor,
  type ProjectView,
} from '../workspace-shared';
import { pageLimit } from './list-members.query';

/** `GET /workspaces/:wsId/projects?archived=false|true|all` (mặc định false). */
export class ListProjectsQuery {
  constructor(private readonly d: { queries: IWorkspaceQueries }) {}

  async execute(
    actor: Actor,
    input: { archived?: 'false' | 'true' | 'all'; after?: string | undefined; limit?: number },
  ): Promise<Page<ProjectView>> {
    requirePermission(actor, 'project:read');
    const page = await this.d.queries.listProjects(actor.workspaceId, input.archived ?? 'false', {
      after: input.after,
      limit: pageLimit(input.limit),
    });
    return { items: page.items.map(toProjectView), nextAfter: page.nextAfter };
  }
}

/** `GET /workspaces/:wsId/projects/:projectId` — project ∉ ws ⇒ 404 (ADR-020). */
export class GetProjectQuery {
  constructor(private readonly d: { projects: IProjectRepository }) {}

  async execute(actor: Actor, input: { projectId: string }): Promise<ProjectView> {
    requirePermission(actor, 'project:read');
    const project = await this.d.projects.findInWorkspace(actor.workspaceId, input.projectId);
    if (!project) throw new ResourceNotFoundError('project');
    return toProjectView(project.toSnapshot());
  }
}
