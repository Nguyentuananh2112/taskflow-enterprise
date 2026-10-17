import { BusinessRuleViolationError, ResourceNotFoundError } from '../../../../core/errors';
import type { Membership } from '../../domain/membership';
import type { IMembershipRepository } from '../ports/repositories.port';
import { requirePermission, type Actor } from '../workspace-shared';

export function lastOwnerViolation(): BusinessRuleViolationError {
  return new BusinessRuleViolationError('LAST_OWNER', 'Workspace phải còn ít nhất một chủ sở hữu.');
}

/**
 * ADR-046 (security.md 3.5): MỌI thao tác có thể làm giảm số OWNER đi qua đây.
 * 1) khóa mọi dòng OWNER của ws (FOR UPDATE, theo thứ tự id) — 2) đọc dòng mục tiêu —
 * 3) trả cả hai để use case quyết định. Gọi TRONG transaction.
 */
export async function lockOwnersAndLoadTarget(
  memberships: IMembershipRepository,
  actor: Actor,
  userId: string,
): Promise<{ owners: string[]; target: Membership; actor: Actor }> {
  const { owners, actor: fresh } = await lockOwnersAndReloadActor(memberships, actor);
  const target = await memberships.find(actor.workspaceId, userId);
  if (!target) throw new ResourceNotFoundError('user');
  return { owners, target, actor: fresh };
}

/**
 * X6 (T-032): `actor.role` do middleware đọc TRƯỚC transaction — một request đang bay của người
 * vừa bị hạ / xóa vẫn mang role cũ. Mọi thao tác đổi role / xóa / thêm thành viên đều khóa các dòng
 * OWNER trước (tuần tự hóa với nhau), nên đọc lại membership của actor SAU khóa là đọc trạng thái đã
 * commit. Mất membership ⇒ 404 workspace (như middleware); role mới vẫn phải có quyền.
 */
export async function lockOwnersAndReloadActor(
  memberships: IMembershipRepository,
  actor: Actor,
  permission?: Parameters<typeof requirePermission>[1],
): Promise<{ owners: string[]; actor: Actor }> {
  const owners = await memberships.lockOwners(actor.workspaceId);
  const me = await memberships.find(actor.workspaceId, actor.userId);
  if (!me) throw new ResourceNotFoundError('workspace');
  const fresh: Actor = { ...actor, role: me.role };
  if (permission) requirePermission(fresh, permission);
  return { owners, actor: fresh };
}

/** Mục tiêu đang là OWNER, thao tác làm nó mất OWNER, và chỉ còn một OWNER ⇒ 422 LAST_OWNER. */
export function assertNotLastOwner(owners: string[], target: Membership): void {
  if (target.role === 'OWNER' && owners.length <= 1) throw lastOwnerViolation();
}
