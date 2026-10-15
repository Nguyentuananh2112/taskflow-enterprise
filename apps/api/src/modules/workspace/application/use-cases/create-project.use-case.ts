import type { IClock, IIdGenerator } from '../../../../core/domain';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { Project } from '../../domain/project';
import type { IProjectRepository } from '../ports/repositories.port';
import {
  requirePermission,
  toProjectView,
  type Actor,
  type ProjectView,
} from '../workspace-shared';

/** `POST /workspaces/:wsId/projects` — PM+. `workspaceId` chỉ lấy từ actor (URL), không từ body. */
export class CreateProjectUseCase {
  constructor(
    private readonly d: {
      projects: IProjectRepository;
      uow: IUnitOfWork;
      ids: IIdGenerator;
      clock: IClock;
    },
  ) {}

  async execute(
    actor: Actor,
    input: { name: string; keyPrefix: string; description?: string | null },
  ): Promise<ProjectView> {
    requirePermission(actor, 'project:create');
    const project = Project.create({
      id: this.d.ids.next(),
      workspaceId: actor.workspaceId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      description: input.description ?? null,
      now: this.d.clock.now(),
    });
    return this.d.uow.run(async () => {
      await this.d.projects.add(project); // keyPrefix trùng trong ws ⇒ 409 field keyPrefix
      return toProjectView(project.toSnapshot());
    });
  }
}
