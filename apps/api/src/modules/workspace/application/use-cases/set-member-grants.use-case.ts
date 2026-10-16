import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { MemberGrant } from '../../domain/roles';
import type { HrAuditWriter } from '../hr-audit-writer';
import type { IUserDirectory, IWorkspaceRealtimeNotifier } from '../ports/collaborators.port';
import type { IMembershipRepository, IWorkspaceRepository } from '../ports/repositories.port';
import { assertWorkspaceLive } from '../workspace-guard';
import { requirePermission, toMemberView, type Actor, type MemberView } from '../workspace-shared';
import { lockOwnersAndReloadActor } from './owner-guard';

export interface SetMemberGrantsDeps {
  memberships: IMembershipRepository;
  workspaces: IWorkspaceRepository;
  users: IUserDirectory;
  audit: HrAuditWriter;
  notifier: Pick<IWorkspaceRealtimeNotifier, 'notifyGrantsChanged'>;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}

/**
 * `PUT /workspaces/:wsId/members/:userId/grants` (ADR-119) — CHỈ OWNER (`hr:grant`). Đặt TOÀN BỘ tập
 * grant (idempotent; `[]` = thu hết). OWNER / VIEWER ⇒ 422 `GRANT_NOT_ALLOWED` (B-M2). Thu có hiệu lực
 * ở request kế tiếp của người bị thu (quyền đọc DB mỗi request), lệnh HR đang bay thì `HrAccess`
 * chặn sau khóa (B-H3a). Có thay đổi ⇒ HrAuditLog GRANT / REVOKE cùng transaction + event sau commit.
 */
export class SetMemberGrantsUseCase {
  constructor(private readonly d: SetMemberGrantsDeps) {}

  async execute(
    actor: Actor,
    input: { userId: string; grants: readonly MemberGrant[]; originClientId?: string | null },
  ): Promise<MemberView> {
    requirePermission(actor, 'hr:grant');
    return this.d.uow.run(async () => {
      // X6: role của người gọi đọc lại sau khóa owners — OWNER vừa bị hạ không cấp được nữa.
      const { actor: fresh } = await lockOwnersAndReloadActor(
        this.d.memberships,
        actor,
        'hr:grant',
      );
      await assertWorkspaceLive(this.d.workspaces, actor.workspaceId);
      const target = await this.d.memberships.find(actor.workspaceId, input.userId);
      if (!target) throw new ResourceNotFoundError('user');
      const user = await this.d.users.findById(input.userId);
      if (!user) throw new ResourceNotFoundError('user');

      const before = [...target.grants];
      if (!target.setGrants(input.grants, this.d.clock.now())) {
        return toMemberView(target.toSnapshot(), user); // no-op: không audit, không event
      }
      await this.d.memberships.save(target);
      const after = [...target.grants];
      await this.d.audit.record({
        workspaceId: actor.workspaceId,
        actorId: fresh.userId,
        action: after.length > before.length ? 'GRANT' : 'REVOKE',
        targetUserId: target.userId,
        before: { grants: before },
        after: { grants: after },
      });

      const meta = { actorId: fresh.userId, originClientId: input.originClientId ?? null };
      this.d.uow.afterCommit(() => {
        // Sự kiện bảo mật (X9): thay đổi quyền quản lý nhân sự.
        this.d.logger.info(
          {
            workspaceId: actor.workspaceId,
            userId: target.userId,
            actorId: fresh.userId,
            before,
            after,
          },
          'member.grants_changed',
        );
        return this.d.notifier.notifyGrantsChanged(
          { userId: target.userId, workspaceId: actor.workspaceId, grants: after },
          meta,
        );
      });
      return toMemberView(target.toSnapshot(), user);
    });
  }
}
