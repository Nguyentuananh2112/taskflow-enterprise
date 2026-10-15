import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { IMembershipRepository, IWorkspaceRepository } from '../ports/repositories.port';
import { toWorkspaceView, type WorkspaceView } from '../workspace-shared';

export interface RestoreWorkspaceDeps {
  workspaces: IWorkspaceRepository;
  memberships: IMembershipRepository;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}

/**
 * `POST /workspaces/:wsId/restore` (ADR-050, security.md 3.6). Route này KHÔNG qua
 * `loadMembership` (ws đã xóa luôn 404 ở đó) — use case tự kiểm OWNER trên ws đã xóa.
 * MỌI thất bại trả cùng một `404 workspace` (kể cả PM/MEMBER của chính ws đó).
 * Không phát socket: thành viên thấy lại ws qua `GET /workspaces` (WSR-08).
 */
export class RestoreWorkspaceUseCase {
  constructor(private readonly d: RestoreWorkspaceDeps) {}

  execute(input: { userId: string; workspaceId: string }): Promise<WorkspaceView> {
    return this.d.uow.run(async () => {
      const now = this.d.clock.now();
      const ws = await this.d.workspaces.findById(input.workspaceId);
      const membership = await this.d.memberships.find(input.workspaceId, input.userId);
      if (!ws || !ws.isDeleted || membership?.role !== 'OWNER' || !ws.isRestorable(now)) {
        throw new ResourceNotFoundError('workspace');
      }
      // UPDATE có điều kiện purge_at > now: loại trừ với job purge (WSR-05).
      if (!(await this.d.workspaces.restoreIfWithinGrace(ws.id, now))) {
        throw new ResourceNotFoundError('workspace');
      }
      const restored = await this.d.workspaces.findById(ws.id);
      if (!restored) throw new ResourceNotFoundError('workspace');
      this.d.uow.afterCommit(() => {
        this.d.logger.info({ userId: input.userId, workspaceId: ws.id }, 'workspace.restored');
      });
      return toWorkspaceView(restored.toSnapshot(), 'OWNER');
    });
  }
}
