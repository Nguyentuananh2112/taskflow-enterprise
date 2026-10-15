import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { assertWorkspaceLive } from '../workspace-guard';
import { saveProjectOrFail } from '../optimistic-save';
import type { IWorkspaceRealtimeNotifier } from '../ports/collaborators.port';
import type { IProjectRepository, IWorkspaceRepository } from '../ports/repositories.port';
import {
  requirePermission,
  toProjectEventDto,
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
    private readonly d: {
      projects: IProjectRepository;
      workspaces: IWorkspaceRepository;
      notifier: Pick<IWorkspaceRealtimeNotifier, 'emitToProject'>;
      uow: IUnitOfWork;
      clock: IClock;
    },
  ) {}

  async execute(
    actor: Actor,
    input: {
      projectId: string;
      name?: string;
      description?: string | null;
      originClientId?: string | null;
    },
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
      await assertWorkspaceLive(this.d.workspaces, actor.workspaceId); // X7
      const project = await this.d.projects.findInWorkspace(actor.workspaceId, input.projectId);
      if (!project) throw new ResourceNotFoundError('project');
      project.update(changes, this.d.clock.now());
      await saveProjectOrFail(this.d.projects, project); // ADR-110: rename ‖ archive (X8)
      // `project:updated` (data-and-api §615) SAU commit, chỉ khi thực sự ghi.
      const snapshot = project.toSnapshot();
      this.d.uow.afterCommit(() =>
        this.d.notifier.emitToProject(
          {
            projectId: snapshot.id,
            type: 'project:updated',
            data: { project: toProjectEventDto(snapshot) },
          },
          { actorId: actor.userId, originClientId: input.originClientId ?? null },
        ),
      );
      return toProjectView(project.toSnapshot());
    });
  }
}
