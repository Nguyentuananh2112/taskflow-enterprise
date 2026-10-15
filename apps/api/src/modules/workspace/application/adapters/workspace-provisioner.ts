import type { IClock, IIdGenerator, IRandom } from '../../../../core/domain';
import type { IWorkspaceProvisioner } from '../../../auth';
import { Project } from '../../domain/project';
import type { IProjectRepository } from '../ports/repositories.port';
import { generateSlug } from '../slug-rules';
import type { WorkspaceCreator } from '../workspace-creator';

/** Workspace/project mặc định khi đăng ký (FR-01). Tên không có trong spec — quyết định T-015. */
export const DEFAULT_PROJECT = { name: 'Dự án đầu tiên', keyPrefix: 'TF' } as const;
const NAME_MAX = 100;

function defaultWorkspaceName(ownerFullName: string): string {
  return [...`Workspace của ${ownerFullName.trim()}`].slice(0, NAME_MAX).join('').trim();
}

/**
 * Hiện thực port `IWorkspaceProvisioner` do module auth định nghĩa (ADR-093) — import TYPE qua
 * public API của auth, wire ở composition root. Chạy BÊN TRONG transaction của Register.
 * Trùng slug ⇒ `ResourceConflictError` field `slug` (từ WorkspaceCreator) — Register thử lại cả
 * transaction với `attempt + 1`.
 */
export class DefaultWorkspaceProvisioner implements IWorkspaceProvisioner {
  constructor(
    private readonly d: {
      creator: WorkspaceCreator;
      projects: IProjectRepository;
      random: IRandom;
      ids: IIdGenerator;
      clock: IClock;
    },
  ) {}

  async provisionDefault(input: {
    ownerId: string;
    ownerFullName: string;
    attempt: number;
  }): Promise<{ workspaceId: string }> {
    const { workspace } = await this.d.creator.createWithOwner({
      name: defaultWorkspaceName(input.ownerFullName),
      slug: generateSlug(input.ownerFullName, input.attempt, this.d.random),
      ownerId: input.ownerId,
    });
    await this.d.projects.add(
      Project.create({
        id: this.d.ids.next(),
        workspaceId: workspace.id,
        name: DEFAULT_PROJECT.name,
        keyPrefix: DEFAULT_PROJECT.keyPrefix,
        description: null,
        now: this.d.clock.now(),
      }),
    );
    return { workspaceId: workspace.id };
  }
}
