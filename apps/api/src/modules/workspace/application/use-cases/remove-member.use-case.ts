import { ForbiddenError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { assertWorkspaceLive } from '../workspace-guard';
import type {
  ITaskAssignmentCleaner,
  IWorkspaceRealtimeNotifier,
} from '../ports/collaborators.port';
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from '../ports/repositories.port';
import { requirePermission, type Actor } from '../workspace-shared';
import { assertNotLastOwner, lockOwnersAndLoadTarget } from './owner-guard';

export interface RemoveMemberDeps {
  memberships: IMembershipRepository;
  workspaces: IWorkspaceRepository;
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
      const loaded = await lockOwnersAndLoadTarget(this.d.memberships, actor, input.userId);
      const { owners, target } = loaded;
      requirePermission(loaded.actor, isSelf ? 'member:leave' : 'member:remove'); // X6: role mới nhất
      await assertWorkspaceLive(this.d.workspaces, actor.workspaceId); // X7
      if (
        !isSelf &&
        loaded.actor.role === 'PM' &&
        (target.role === 'OWNER' || target.role === 'PM')
      ) {
        throw new ForbiddenError('member:remove');
      }
      assertNotLastOwner(owners, target);

      await this.d.memberships.remove(actor.workspaceId, target.userId);
      const projectIds = await this.d.projects.listIds(actor.workspaceId);
      const meta = { actorId: actor.userId, originClientId: input.originClientId ?? null };
      // Thu hồi ĐĂNG KÝ TRƯỚC các hook bỏ gán task (hook chạy tuần tự theo thứ tự đăng ký): người bị
      // xóa rời phòng ngay sau commit, không tiếp tục nhận event của workspace trong lúc 2N hook
      // `task:updated` / publish của cleaner chạy (G1 realtime F3).
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
      const { unassignedTaskCount } = await this.d.cleaner.unassignAllForUser({
        workspaceId: actor.workspaceId,
        userId: target.userId,
        actorId: actor.userId,
      });
      return { userId: target.userId, unassignedTaskCount };
    });
  }
}
