import { ForbiddenError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type {
  ITaskAssignmentCleaner,
  IWorkspaceRealtimeNotifier,
} from '../ports/collaborators.port';
import type { IMembershipRepository, IProjectRepository } from '../ports/repositories.port';
import { requirePermission, type Actor } from '../workspace-shared';
import { assertNotLastOwner, lockOwnersAndLoadTarget } from './owner-guard';

export interface RemoveMemberDeps {
  memberships: IMembershipRepository;
  projects: IProjectRepository;
  cleaner: ITaskAssignmentCleaner;
  notifier: IWorkspaceRealtimeNotifier;
  uow: IUnitOfWork;
  logger: ILogger;
}

/**
 * `DELETE /workspaces/:wsId/members/:userId` — gồm cả tự rời (`member:leave`, mọi role).
 * Xóa người khác: cần `member:remove`; PM chỉ xóa MEMBER/VIEWER. Thứ tự lỗi: 403 quyền chung →
 * 404 user → 403 theo role mục tiêu → 422 LAST_OWNER.
 */
export class RemoveMemberUseCase {
  constructor(private readonly d: RemoveMemberDeps) {}

  async execute(
    actor: Actor,
    input: { userId: string; originClientId?: string | null },
  ): Promise<{ userId: string; unassignedTaskCount: number }> {
    const isSelf = input.userId === actor.userId;
    requirePermission(actor, isSelf ? 'member:leave' : 'member:remove');

    return this.d.uow.run(async () => {
      const { owners, target } = await lockOwnersAndLoadTarget(
        this.d.memberships,
        actor.workspaceId,
        input.userId,
      );
      if (!isSelf && actor.role === 'PM' && (target.role === 'OWNER' || target.role === 'PM')) {
        throw new ForbiddenError('member:remove');
      }
      assertNotLastOwner(owners, target);

      await this.d.memberships.remove(actor.workspaceId, target.userId);
      const { unassignedTaskCount } = await this.d.cleaner.unassignAllForUser({
        workspaceId: actor.workspaceId,
        userId: target.userId,
        actorId: actor.userId,
      });
      const projectIds = await this.d.projects.listIds(actor.workspaceId);
      const meta = { actorId: actor.userId, originClientId: input.originClientId ?? null };
      this.d.uow.afterCommit(() => {
        // Sự kiện bảo mật (ASVS V16, T-028): mất quyền truy cập workspace.
        this.d.logger.info(
          { workspaceId: actor.workspaceId, userId: target.userId, actorId: actor.userId },
          'member.removed',
        );
        return this.d.notifier.revokeWorkspaceAccess(
          { userId: target.userId, workspaceId: actor.workspaceId, projectIds },
          meta,
        );
      });
      return { userId: target.userId, unassignedTaskCount };
    });
  }
}
