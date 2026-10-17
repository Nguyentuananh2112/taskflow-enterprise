import { ForbiddenError, ResourceNotFoundError } from '../../../core/errors';
import type { CompanyMemberSnapshot } from '../domain/company-member';
import type { CompanyAccess } from './company-access';
import type { CompanyActor, ICompanyMemberRepository } from './ports/company-member.port';

/**
 * Lệnh `hr:manage` lên MỘT người (lịch nghỉ, tạo lại link — ADR-137, SEC-HR-31): khóa + đọc lại actor (401 / 403,
 * self ⇒ 403) → người đích phải còn dòng (404 user) → Admin / người giữ grant chỉ Admin tác động được (403).
 */
export async function authorizeOnEmployee(
  d: { access: CompanyAccess; members: ICompanyMemberRepository },
  actorId: string,
  userId: string,
): Promise<{ actor: CompanyActor; target: CompanyMemberSnapshot }> {
  const actor = await d.access.authorizeWrite({ actorId, targetUserId: userId });
  const target = await d.members.find(userId);
  if (!target) throw new ResourceNotFoundError('user');
  if ((target.role === 'ADMIN' || target.grants.length > 0) && actor.role !== 'ADMIN') {
    throw new ForbiddenError('company:admin');
  }
  return { actor, target };
}
