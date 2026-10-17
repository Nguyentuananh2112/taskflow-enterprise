import type { IClock, IIdGenerator } from '../../../../core/domain';
import { ForbiddenError, ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { assertWorkspaceLive } from '../workspace-guard';
import { Membership } from '../../domain/membership';
import { isWorkspaceRole, type WorkspaceRole } from '../../domain/roles';
import type { ICompanyMembershipGate, IUserDirectory } from '../ports/collaborators.port';
import type { IMembershipRepository, IWorkspaceRepository } from '../ports/repositories.port';
import { lockOwnersAndReloadActor } from './owner-guard';
import { requirePermission, toMemberView, type Actor, type MemberView } from '../workspace-shared';

/** Role người gọi được phép cấp (security.md 3.2): PM chỉ cấp MEMBER/VIEWER, OWNER cấp bất kỳ. */
function canGrant(actorRole: WorkspaceRole, role: WorkspaceRole): boolean {
  if (actorRole === 'OWNER') return true;
  return actorRole === 'PM' && (role === 'MEMBER' || role === 'VIEWER');
}

export function parseRole(raw: string): WorkspaceRole {
  if (!isWorkspaceRole(raw)) {
    throw new ValidationError([
      { path: ['role'], code: 'invalid_value', message: 'Vai trò không hợp lệ.' },
    ]);
  }
  return raw;
}

/**
 * `POST /workspaces/:wsId/members` — Mốc 3.5 (ADR-134): chọn người trong công ty theo `userId` (combobox
 * `member-candidates`), không còn nhập email tự do. Không thuộc công ty / đã nghỉ ⇒ 404 user (như không có).
 */
export class AddMemberUseCase {
  constructor(
    private readonly d: {
      memberships: IMembershipRepository;
      workspaces: IWorkspaceRepository;
      users: IUserDirectory;
      company: ICompanyMembershipGate;
      uow: IUnitOfWork;
      ids: IIdGenerator;
      clock: IClock;
      logger: ILogger;
    },
  ) {}

  async execute(actor: Actor, input: { userId: string; role: string }): Promise<MemberView> {
    requirePermission(actor, 'member:add');
    const role = parseRole(input.role);
    // Kiểm quyền cấp role TRƯỚC khi tra user (MEM-03): không tốn truy vấn, không lộ email tồn tại.
    if (!canGrant(actor.role, role)) throw new ForbiddenError('member:add');

    // Không có / không còn thuộc công ty ⇒ cùng 404 user (rate limit 30/giờ như trước).
    const user = await this.d.users.findById(input.userId);
    if (!user || !(await this.d.company.isActive(user.id))) throw new ResourceNotFoundError('user');

    return this.d.uow.run(async () => {
      // X6: role của người gọi đọc lại sau khóa owners — PM vừa bị hạ / xóa không thêm được ai.
      const { actor: fresh } = await lockOwnersAndReloadActor(
        this.d.memberships,
        actor,
        'member:add',
      );
      if (!canGrant(fresh.role, role)) throw new ForbiddenError('member:add');
      await assertWorkspaceLive(this.d.workspaces, actor.workspaceId); // X7
      const membership = Membership.create({
        id: this.d.ids.next(),
        workspaceId: actor.workspaceId,
        userId: user.id,
        role,
        now: this.d.clock.now(),
      });
      await this.d.memberships.add(membership); // đã là thành viên ⇒ 409 (unique)
      // Sự kiện bảo mật (X9): cấp quyền truy cập workspace.
      this.d.uow.afterCommit(() => {
        this.d.logger.info(
          { workspaceId: actor.workspaceId, userId: user.id, actorId: actor.userId, role },
          'member.added',
        );
      });
      return toMemberView(membership.toSnapshot(), user);
    });
  }
}
