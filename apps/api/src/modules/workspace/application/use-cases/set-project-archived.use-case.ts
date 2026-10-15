import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { assertWorkspaceLive } from '../workspace-guard';
import { saveProjectOrFail } from '../optimistic-save';
import type { IProjectRepository, IWorkspaceRepository } from '../ports/repositories.port';
import {
  requirePermission,
  toProjectView,
  type Actor,
  type ProjectView,
} from '../workspace-shared';

/** `POST …/projects/:projectId/archive | unarchive` — PM+, idempotent (ARC-02, ARC-05). */
export class SetProjectArchivedUseCase {
  constructor(
    private readonly d: {
      projects: IProjectRepository;
      workspaces: IWorkspaceRepository;
      uow: IUnitOfWork;
      clock: IClock;
    },
  ) {}

  async execute(
    actor: Actor,
    input: { projectId: string; archived: boolean },
  ): Promise<ProjectView> {
    requirePermission(actor, 'project:archive');
    return this.d.uow.run(async () => {
      await assertWorkspaceLive(this.d.workspaces, actor.workspaceId); // X7
      const project = await this.d.projects.findInWorkspace(actor.workspaceId, input.projectId);
      if (!project) throw new ResourceNotFoundError('project');
      const now = this.d.clock.now();
      const changed = input.archived ? project.archive(now) : project.unarchive(now);
      if (changed) await saveProjectOrFail(this.d.projects, project); // ADR-110 (X8)
      return toProjectView(project.toSnapshot());
    });
  }
}
