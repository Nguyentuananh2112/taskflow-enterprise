import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { saveWorkspaceOrFail } from '../optimistic-save';
import type { IWorkspaceRealtimeNotifier } from '../ports/collaborators.port';
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from '../ports/repositories.port';
import {
  requirePermission,
  toDeletedWorkspaceView,
  type Actor,
  type DeletedWorkspaceView,
} from '../workspace-shared';

export interface DeleteWorkspaceDeps {
  workspaces: IWorkspaceRepository;
  memberships: IMembershipRepository;
  projects: IProjectRepository;
  notifier: IWorkspaceRealtimeNotifier;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}

/**
 * Xóa mềm (ADR-047, data-and-api 1.7): giữ nguyên member/project/task để khôi phục được.
 * Sau commit: báo mọi thành viên + đẩy socket khỏi phòng project.
 */
export class DeleteWorkspaceUseCase {
  constructor(private readonly d: DeleteWorkspaceDeps) {}

  async execute(
    actor: Actor,
    input: { confirmSlug: string; originClientId?: string | null },
  ): Promise<DeletedWorkspaceView> {
    requirePermission(actor, 'workspace:delete');
    return this.d.uow.run(async () => {
      const ws = await this.d.workspaces.findById(actor.workspaceId);
      if (!ws || ws.isDeleted) throw new ResourceNotFoundError('workspace');
      if (input.confirmSlug !== ws.slug) {
        throw new ValidationError([
          { path: ['confirmSlug'], code: 'mismatch', message: 'Slug xác nhận không khớp.' },
        ]);
      }
      ws.softDelete(actor.userId, this.d.clock.now());
      await saveWorkspaceOrFail(this.d.workspaces, ws); // ADR-110: PATCH ‖ DELETE không hồi sinh (X2)

      // Đọc TRONG transaction: danh sách đúng tại thời điểm xóa.
      const projectIds = await this.d.projects.listIds(ws.id);
      const memberUserIds = await this.d.memberships.listUserIds(ws.id);
      const meta = { actorId: actor.userId, originClientId: input.originClientId ?? null };
      this.d.uow.afterCommit(() => {
        // Sự kiện bảo mật (X9): mọi thành viên mất quyền truy cập; khôi phục được tới purgeAt.
        this.d.logger.info(
          { workspaceId: ws.id, actorId: actor.userId, purgeAt: ws.purgeAt },
          'workspace.deleted',
        );
        return this.d.notifier.closeWorkspace(
          { workspaceId: ws.id, projectIds, memberUserIds },
          meta,
        );
      });
      return toDeletedWorkspaceView(ws.toSnapshot());
    });
  }
}
