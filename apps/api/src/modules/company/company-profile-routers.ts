import type { RequestHandler, Router } from 'express';

import type { IClock } from '../../core/domain';
import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { ILogger } from '../../core/logging/logger';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import type { CompanyAccess } from './application/company-access';
import type { HrAuditWriter } from './application/hr-audit-writer';
import { ListHrAuditLogsQuery } from './application/list-hr-audit-logs.query';
import type { ICompanyRepository } from './application/ports/company-member.port';
import type { IHrAuditLog } from './application/ports/hr-audit.port';
import {
  GetCompanyQuery,
  RenameCompanyUseCase,
} from './application/use-cases/company-profile.use-cases';
import type { CompanyPermission } from './domain/roles';
import { COMPANY_PATH, CompanyController, companyRoutes } from './presentation/company.routes';
import { HR_AUDIT_PATH, HrAuditController, hrAuditRoutes } from './presentation/hr-audit.routes';

/**
 * Router `/hr/audit-logs` (chỉ Admin) và `/company` (đọc tên; Admin đổi tên) của module company — tách khỏi
 * company.module.ts (max-lines), cùng tầng composition của module.
 */
export function companyProfileRouters(
  d: {
    company: ICompanyRepository;
    hrAudit: IHrAuditLog;
    access: CompanyAccess;
    audit: HrAuditWriter;
    permissionsOf: (userId: string) => Promise<ReadonlySet<CompanyPermission> | null>;
    uow: IUnitOfWork;
    clock: IClock;
    logger: ILogger;
    responder: HttpResponder;
    limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  },
  authenticate: RequestHandler,
): { path: string; router: Router }[] {
  const { permissionsOf, responder, limit } = d;
  return [
    {
      path: HR_AUDIT_PATH,
      router: hrAuditRoutes({
        controller: new HrAuditController({ list: new ListHrAuditLogsQuery(d), responder }),
        permissionsOf,
        authenticate,
        limit,
      }),
    },
    {
      path: COMPANY_PATH,
      router: companyRoutes({
        controller: new CompanyController({
          get: new GetCompanyQuery(d),
          rename: new RenameCompanyUseCase(d),
          responder,
        }),
        permissionsOf,
        authenticate,
        limit,
      }),
    },
  ];
}
