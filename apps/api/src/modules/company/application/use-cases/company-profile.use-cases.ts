import type { IClock } from '../../../../core/domain';
import {
  ResourceNotFoundError,
  SessionRevokedError,
  VersionConflictError,
} from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { CompanyPermission } from '../../domain/roles';
import type { CompanyAccess } from '../company-access';
import type { HrAuditWriter } from '../hr-audit-writer';
import type { CompanyProfile, ICompanyRepository } from '../ports/company-member.port';

/** `GET /company` — mọi người đang thuộc công ty (header công ty mọi trang — ADR-139). */
export class GetCompanyQuery {
  constructor(
    private readonly d: {
      company: Pick<ICompanyRepository, 'get'>;
      permissionsOf(userId: string): Promise<ReadonlySet<CompanyPermission> | null>;
    },
  ) {}

  async execute(actorId: string): Promise<CompanyProfile> {
    if ((await this.d.permissionsOf(actorId)) === null) throw new SessionRevokedError();
    const company = await this.d.company.get();
    if (!company) throw new ResourceNotFoundError('company');
    return company;
  }
}

/**
 * `PATCH /company {name?, privacyContact?, expectedVersion}` — `company:admin` (ADR-134) chốt dưới khóa FOR SHARE dòng
 * của actor (B-H3); `version` lệch ⇒ 409 VERSION_CONFLICT kèm bản hiện tại (ADR-010). Audit `COMPANY_RENAMED` {name}
 * cùng transaction CHỈ khi tên đổi (B: tên hiện ở mọi trang); đầu mối quyền riêng tư (T-075) không audit (TL).
 * `privacyContact` rỗng ⇒ null (xóa).
 */
export class RenameCompanyUseCase {
  constructor(
    private readonly d: {
      access: Pick<CompanyAccess, 'authorizeWrite'>;
      company: Pick<ICompanyRepository, 'get' | 'update'>;
      audit: Pick<HrAuditWriter, 'record'>;
      uow: IUnitOfWork;
      clock: IClock;
      logger: ILogger;
    },
  ) {}

  execute(input: {
    actorId: string;
    name?: string | undefined;
    privacyContact?: string | null | undefined;
    expectedVersion: number;
  }): Promise<CompanyProfile> {
    return this.d.uow.run(async () => {
      await this.d.access.authorizeWrite({ actorId: input.actorId, permission: 'company:admin' });
      const before = await this.d.company.get();
      if (!before) throw new ResourceNotFoundError('company');
      const next = await this.d.company.update({
        name: input.name,
        privacyContact: input.privacyContact === '' ? null : input.privacyContact,
        expectedVersion: input.expectedVersion,
        at: this.d.clock.now(),
      });
      if (!next) {
        const current = (await this.d.company.get()) ?? before;
        throw new VersionConflictError(current.version, current);
      }
      if (next.name === before.name) return next;
      await this.d.audit.record({
        actorId: input.actorId,
        action: 'COMPANY_RENAMED',
        targetUserId: null,
        refId: null,
        before: { name: before.name },
        after: { name: next.name },
      });
      this.d.uow.afterCommit(() => {
        this.d.logger.info({ actorId: input.actorId, version: next.version }, 'company.renamed');
      });
      return next;
    });
  }
}
