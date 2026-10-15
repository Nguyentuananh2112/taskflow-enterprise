import type { IClock, IIdGenerator } from '../../../../core/domain';
import { ForbiddenError, ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { Membership } from '../../domain/membership';
import { isWorkspaceRole, type WorkspaceRole } from '../../domain/roles';
import type { IUserDirectory } from '../ports/collaborators.port';
import type { IMembershipRepository } from '../ports/repositories.port';
import {
  normalizeEmail,
  requirePermission,
  toMemberView,
  type Actor,
  type MemberView,
} from '../workspace-shared';

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

/** `POST /workspaces/:wsId/members` — thêm user ĐÃ có tài khoản (lời mời qua email: sau v1). */
export class AddMemberUseCase {
  constructor(
    private readonly d: {
      memberships: IMembershipRepository;
      users: IUserDirectory;
      uow: IUnitOfWork;
      ids: IIdGenerator;
      clock: IClock;
    },
  ) {}

  async execute(actor: Actor, input: { email: string; role: string }): Promise<MemberView> {
    requirePermission(actor, 'member:add');
    const role = parseRole(input.role);
    // Kiểm quyền cấp role TRƯỚC khi tra user (MEM-03): không tốn truy vấn, không lộ email tồn tại.
    if (!canGrant(actor.role, role)) throw new ForbiddenError('member:add');

    // Email không có tài khoản ⇒ 404 user (security.md 6.5, ADR-090; bù bằng rate limit 30/giờ).
    const user = await this.d.users.findByEmail(normalizeEmail(input.email));
    if (!user) throw new ResourceNotFoundError('user');

    return this.d.uow.run(async () => {
      const membership = Membership.create({
        id: this.d.ids.next(),
        workspaceId: actor.workspaceId,
        userId: user.id,
        role,
        now: this.d.clock.now(),
      });
      await this.d.memberships.add(membership); // đã là thành viên ⇒ 409 (unique)
      return toMemberView(membership.toSnapshot(), user);
    });
  }
}
