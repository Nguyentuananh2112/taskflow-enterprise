import { ResourceNotFoundError } from '../../../../core/errors';
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from '../ports/repositories.port';
import type { ICompanyMembershipGate, IProjectAccessChecker } from '../ports/collaborators.port';
import { WorkspaceAccess } from './workspace-access';

/**
 * Kiểm `project:join` của socket (security.md 5.2) — chữ ký chốt với A (T-016):
 * `IProjectAccessChecker.canAccessProject` ở `core/realtime` (chưa có trên main).
 * Khai `implements` bản sao cục bộ của chữ ký (core không import module nên không dùng chung type
 * được theo chiều ngược lại); composition root kiểm khớp với bản ở `core/realtime` khi wire.
 * Project archived vẫn `true` (đọc được). Gọi lại khi `auth:renew` (security.md 5.3).
 */
export class WorkspaceProjectAccessChecker implements IProjectAccessChecker {
  readonly #access: WorkspaceAccess;

  constructor(
    private readonly d: {
      workspaces: IWorkspaceRepository;
      memberships: IMembershipRepository;
      projects: IProjectRepository;
      company: ICompanyMembershipGate;
    },
  ) {
    this.#access = new WorkspaceAccess(d);
  }

  async canAccessProject(input: {
    userId: string;
    workspaceId: string;
    projectId: string;
  }): Promise<boolean> {
    const { userId, workspaceId, projectId } = input;
    try {
      await this.#access.resolveActor(workspaceId, userId);
    } catch (err) {
      if (err instanceof ResourceNotFoundError) return false;
      throw err;
    }
    return (await this.d.projects.findInWorkspace(workspaceId, projectId)) !== null;
  }
}
