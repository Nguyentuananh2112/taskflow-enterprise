import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { CompanyAccess } from '../company-access';
import { authorizeOnEmployee } from '../employment-shared';
import type { HrAuditWriter } from '../hr-audit-writer';
import type { ICompanyAccounts } from '../ports/accounts.port';
import type { ICompanyMemberRepository } from '../ports/company-member.port';

/**
 * `DELETE /hr/employees/:userId/avatar` (ADR-142, SEC-CH-17): `hr:manage`; ảnh của Admin / người giữ grant CHỈ Admin
 * gỡ; không tự gỡ qua route này (dùng `DELETE /me/avatar`) — chung luật `authorizeOnEmployee`. Gỡ + audit
 * `AVATAR_REMOVED` CÙNG transaction; blob giữ 30 ngày (D13 — phục hồi được nếu gỡ nhầm). Không có ảnh ⇒ 204, không audit.
 */
export class RemoveEmployeeAvatarUseCase {
  constructor(
    private readonly d: {
      access: CompanyAccess;
      members: ICompanyMemberRepository;
      accounts: Pick<ICompanyAccounts, 'removeAvatar'>;
      audit: HrAuditWriter;
      uow: IUnitOfWork;
    },
  ) {}

  execute(input: { actorId: string; userId: string }): Promise<void> {
    return this.d.uow.run(async () => {
      const { actor, target } = await authorizeOnEmployee(this.d, input.actorId, input.userId);
      const { previousVersion } = await this.d.accounts.removeAvatar({
        userId: target.userId,
        actorId: actor.userId,
      });
      if (previousVersion === null) return;
      await this.d.audit.record({
        actorId: actor.userId,
        action: 'AVATAR_REMOVED',
        targetUserId: target.userId,
        before: { avatarVersion: previousVersion },
      });
    });
  }
}
