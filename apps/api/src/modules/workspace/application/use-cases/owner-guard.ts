import { BusinessRuleViolationError, ResourceNotFoundError } from '../../../../core/errors';
import type { Membership } from '../../domain/membership';
import type { IMembershipRepository } from '../ports/repositories.port';

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
  workspaceId: string,
  userId: string,
): Promise<{ owners: string[]; target: Membership }> {
  const owners = await memberships.lockOwners(workspaceId);
  const target = await memberships.find(workspaceId, userId);
  if (!target) throw new ResourceNotFoundError('user');
  return { owners, target };
}

/** Mục tiêu đang là OWNER, thao tác làm nó mất OWNER, và chỉ còn một OWNER ⇒ 422 LAST_OWNER. */
export function assertNotLastOwner(owners: string[], target: Membership): void {
  if (target.role === 'OWNER' && owners.length <= 1) throw lastOwnerViolation();
}
