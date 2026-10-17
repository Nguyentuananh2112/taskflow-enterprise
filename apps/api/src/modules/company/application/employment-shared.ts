import { ForbiddenError, ResourceNotFoundError, VersionConflictError } from '../../../core/errors';
import type { CompanyMemberSnapshot } from '../domain/company-member';
import type { CompanyAccess } from './company-access';
import type { CompanyActor, ICompanyMemberRepository } from './ports/company-member.port';

/**
 * Lệnh `hr:manage` lên MỘT người (lịch nghỉ, tạo lại link — ADR-137, SEC-HR-31): khóa + đọc lại actor (401 / 403,
 * self ⇒ 403) → người đích phải còn dòng (404 user) → Admin / người giữ grant chỉ Admin tác động được (403).
 *
 * Thứ tự khóa ADR-136 (A review T-062 HIGH-1): người đích là Admin ⇒ `taskflow:company:admins` (bậc 2) TRƯỚC mọi khóa
 * dòng `company_members` (bậc 5) — như `PUT /admin/access`; không thì deadlock với lệnh hạ Admin đồng thời. Đọc
 * trước KHÔNG khóa; sau khóa role khác lúc đọc ⇒ 409 VERSION_CONFLICT (không lấy khóa muộn).
 */
export async function authorizeOnEmployee(
  d: { access: CompanyAccess; members: ICompanyMemberRepository },
  actorId: string,
  userId: string,
  /** Khóa bậc 3 (leave / punch) khi lệnh sẽ đụng dòng người đích — sau bậc 2, TRƯỚC bậc 5 (ADR-136). */
  beforeRowLocks?: () => Promise<void>,
): Promise<{ actor: CompanyActor; target: CompanyMemberSnapshot }> {
  const peek = await d.members.find(userId);
  if (peek?.role === 'ADMIN') await d.members.lockAdmins();
  await beforeRowLocks?.();
  const actor = await d.access.authorizeWrite({ actorId, targetUserId: userId });
  const target = await d.members.find(userId);
  if (!target) throw new ResourceNotFoundError('user');
  if (peek && target.role !== peek.role) throw new VersionConflictError(target.version);
  if ((target.role === 'ADMIN' || target.grants.length > 0) && actor.role !== 'ADMIN') {
    throw new ForbiddenError('company:admin');
  }
  return { actor, target };
}
