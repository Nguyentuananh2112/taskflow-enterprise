import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { saveProjectOrFail } from '../optimistic-save';
import type { IProjectRepository } from '../ports/repositories.port';
import {
  requirePermission,
  toProjectView,
  type Actor,
  type ProjectView,
} from '../workspace-shared';

/**
 * `PATCH /workspaces/:wsId/projects/:projectId` — PM+, `{ name?, description? }` (keyPrefix bất
 * biến, R17). Thứ tự: 403 quyền → 404 project ∉ ws → 422 PROJECT_ARCHIVED (PRU-04).
 */
export class UpdateProjectUseCase {
  constructor(
    private readonly d: { projects: IProjectRepository; uow: IUnitOfWork; clock: IClock },
  ) {}

  async execute(
    actor: Actor,
    input: { projectId: string; name?: string; description?: string | null },
  ): Promise<ProjectView> {
    requirePermission(actor, 'project:update');
    const changes: { name?: string; description?: string | null } = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.description !== undefined) changes.description = input.description;
    if (Object.keys(changes).length === 0) {
      throw new ValidationError([
        { path: [], code: 'too_small', message: 'Cần ít nhất một trường để cập nhật.' },
      ]);
    }
    return this.d.uow.run(async () => {
      const project = await this.d.projects.findInWorkspace(actor.workspaceId, input.projectId);
      if (!project) throw new ResourceNotFoundError('project');
      project.update(changes, this.d.clock.now());
      await saveProjectOrFail(this.d.projects, project); // ADR-110: rename ‖ archive (X8)
      return toProjectView(project.toSnapshot());
    });
  }
}
