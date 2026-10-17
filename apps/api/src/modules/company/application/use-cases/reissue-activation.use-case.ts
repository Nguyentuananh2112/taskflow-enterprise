import { BusinessRuleViolationError, ResourceNotFoundError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { CompanyAccess } from '../company-access';
import { authorizeOnEmployee } from '../employment-shared';
import type { HrAuditWriter } from '../hr-audit-writer';
import type { ICompanyAccounts } from '../ports/accounts.port';
import type { ICompanyMemberRepository } from '../ports/company-member.port';
import { EMPLOYEE_ACTIVATION_TTL_MS } from './hire-employee.use-case';

/**
 * `POST /hr/employees/:userId/activation-link` (`hr:manage`, ADR-137 điều 2): link cũ chết NGAY, cấp link 7 ngày mới
 * (token một lần trong response, `no-store`). Đã kích hoạt ⇒ 422 `ALREADY_ACTIVATED`; Admin / người giữ grant chỉ
 * Admin làm (SEC-HR-31).
 */
export class ReissueActivationUseCase {
  constructor(
    private readonly d: {
      access: CompanyAccess;
      members: ICompanyMemberRepository;
      accounts: ICompanyAccounts;
      audit: HrAuditWriter;
      uow: IUnitOfWork;
    },
  ) {}

  execute(input: {
    actorId: string;
    userId: string;
  }): Promise<{ token: string; link: string; expiresAt: Date }> {
    const d = this.d;
    return d.uow.run(async () => {
      const { actor, target } = await authorizeOnEmployee(d, input.actorId, input.userId);
      const account = await d.accounts.findById(target.userId);
      if (!account || account.deleted) throw new ResourceNotFoundError('user');
      if (account.hasPassword) {
        throw new BusinessRuleViolationError('ALREADY_ACTIVATED', 'Tài khoản đã được kích hoạt.');
      }
      const activation = await d.accounts.issueActivation({
        userId: target.userId,
        createdById: actor.userId,
        ttlMs: EMPLOYEE_ACTIVATION_TTL_MS,
      });
      await d.audit.record({
        actorId: actor.userId,
        action: 'ACTIVATION_LINK_ISSUED',
        targetUserId: target.userId,
        after: { expiresAt: activation.expiresAt.toISOString(), reissued: true },
      });
      return activation;
    });
  }
}
