import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { HrAuditWriter } from '../hr-audit-writer';
import { assertWorkspaceLive } from '../workspace-guard';
import type {
  ITaskAssignmentCleaner,
  IUserDirectory,
  IWorkspaceRealtimeNotifier,
} from '../ports/collaborators.port';
import type { IMembershipRepository, IWorkspaceRepository } from '../ports/repositories.port';
import { requirePermission, toMemberView, type Actor, type MemberView } from '../workspace-shared';
import { parseRole } from './add-member.use-case';
import { assertNotLastOwner, lockOwnersAndLoadTarget } from './owner-guard';

export interface ChangeMemberRoleDeps {
  memberships: IMembershipRepository;
  workspaces: IWorkspaceRepository;
  users: IUserDirectory;
  cleaner: ITaskAssignmentCleaner;
  notifier: IWorkspaceRealtimeNotifier;
  /** ADR-119: đổi role xóa grants (sang OWNER / VIEWER) ⇒ HrAuditLog REVOKE cùng transaction (GR-09). */
  audit: HrAuditWriter;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}

/**
 * `PATCH /workspaces/:wsId/members/:userId` — OWNER. Không hạ OWNER cuối cùng (ADR-046);
 * hạ xuống VIEWER ⇒ bỏ gán mọi task của họ trong cùng transaction (ADR-044, ADR-092).
 */
export class ChangeMemberRoleUseCase {
  constructor(private readonly d: ChangeMemberRoleDeps) {}

  async execute(
    actor: Actor,
    input: { userId: string; role: string; originClientId?: string | null },
  ): Promise<{ member: MemberView; unassignedTaskCount: number }> {
    requirePermission(actor, 'member:update-role');
    const role = parseRole(input.role);

    return this.d.uow.run(async () => {
      const loaded = await lockOwnersAndLoadTarget(this.d.memberships, actor, input.userId);
      const { owners, target } = loaded;
      requirePermission(loaded.actor, 'member:update-role'); // X6: role mới nhất
      await assertWorkspaceLive(this.d.workspaces, actor.workspaceId); // X7
      if (role !== 'OWNER') assertNotLastOwner(owners, target);
      const user = await this.d.users.findById(target.userId);
      if (!user) throw new ResourceNotFoundError('user');

      const previousRole = target.role;
      const grantsBefore = [...target.grants];
      if (!target.changeRole(role, this.d.clock.now())) {
        return { member: toMemberView(target.toSnapshot(), user), unassignedTaskCount: 0 }; // ROL-08
      }
      await this.d.memberships.save(target);
      const unassignedTaskCount =
        role === 'VIEWER'
          ? (
              await this.d.cleaner.unassignAllForUser({
                workspaceId: actor.workspaceId,
                userId: target.userId,
                actorId: actor.userId,
              })
            ).unassignedTaskCount
          : 0;

      // Hạ / nâng sang role không giữ được grant ⇒ grants vừa bị xóa trong CÙNG câu UPDATE (save ở trên).
      const grantsAfter = [...target.grants];
      const grantsCleared = grantsBefore.length > 0 && grantsAfter.length === 0;
      if (grantsCleared) {
        await this.d.audit.record({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          action: 'REVOKE',
          targetUserId: target.userId,
          before: { grants: grantsBefore, role: previousRole },
          after: { grants: grantsAfter, role },
        });
      }

      const meta = { actorId: actor.userId, originClientId: input.originClientId ?? null };
      if (grantsCleared) {
        this.d.uow.afterCommit(() =>
          this.d.notifier.notifyGrantsChanged(
            { userId: target.userId, workspaceId: actor.workspaceId, grants: grantsAfter },
            meta,
          ),
        );
      }
      this.d.uow.afterCommit(() => {
        // Sự kiện bảo mật (ASVS V16, T-028): thay đổi quyền.
        this.d.logger.info(
          {
            workspaceId: actor.workspaceId,
            userId: target.userId,
            actorId: actor.userId,
            from: previousRole,
            to: role,
            grants: grantsAfter, // GR-10: grants còn lại sau khi đổi role
          },
          'member.role_changed',
        );
        return this.d.notifier.notifyRoleChanged(
          { userId: target.userId, workspaceId: actor.workspaceId, role },
          meta,
        );
      });
      return { member: toMemberView(target.toSnapshot(), user), unassignedTaskCount };
    });
  }
}
