import type { RequestHandler, Router } from 'express';

import type { IClock, IIdGenerator } from '../../core/domain';
import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { ILogger } from '../../core/logging/logger';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import { CompanyAccess } from './application/company-access';
import { HrAuditWriter } from './application/hr-audit-writer';
import type { ICompanyAccounts } from './application/ports/accounts.port';
import {
  BootstrapAdminUseCase,
  type BootstrapAdminInput,
  type BootstrapAdminResult,
} from './application/use-cases/bootstrap-admin.use-case';
import { HireEmployeeUseCase } from './application/use-cases/hire-employee.use-case';
import type {
  ICompanyMemberRepository,
  ICompanyRepository,
  ICompanyTenureReader,
} from './application/ports/company-member.port';
import type { IHrAuditLog } from './application/ports/hr-audit.port';
import { DEFAULT_COMPANY_TIME_ZONE, isCompanyAccessActive } from './domain/company-member';
import { HrController, hrRoutes } from './presentation/hr.routes';
import {
  effectiveCompanyPermissions,
  type CompanyGrant,
  type CompanyPermission,
  type CompanyRole,
} from './domain/roles';

/** Khớp cấu trúc `MeCompanyDto` (contracts) — `GET /auth/me`. */
export interface MeCompanyView {
  name: string | null;
  role: CompanyRole;
  grants: CompanyGrant[];
  permissions: CompanyPermission[];
  status: 'ACTIVE' | 'OFFBOARDING';
  offboardLastDay: string | null;
}

export interface CompanyRepositories {
  company: ICompanyRepository;
  members: ICompanyMemberRepository;
  tenures: ICompanyTenureReader;
  hrAudit: IHrAuditLog;
}

export interface CompanyModuleDeps {
  repos: CompanyRepositories;
  ids: IIdGenerator;
  /** Giờ NGHIỆP VỤ — `access_until` so với đồng hồ này (R31). */
  clock: IClock;
  uow: IUnitOfWork;
  logger: ILogger;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  /**
   * Tài khoản (module auth — tạo SAU company vì auth cần cổng công ty) ⇒ tham chiếu trễ, đọc lúc chạy
   * request; composition gán `current` trước khi app nhận request.
   */
  accounts: { current: ICompanyAccounts | null };
  /** Múi giờ lịch hiện hành (ADR-120) — attendance (T-063) nối; mặc định Asia/Ho_Chi_Minh. */
  timeZone?: () => Promise<string>;
}

export interface CompanyModule {
  access: CompanyAccess;
  tenures: ICompanyTenureReader;
  members: ICompanyMemberRepository;
  hrAudit: HrAuditWriter;
  /** Quyền công ty hiện tại (đọc DB, không cache); `null` = không thuộc công ty / quá `access_until`. */
  permissionsOf(userId: string): Promise<ReadonlySet<CompanyPermission> | null>;
  /** Phần `company` của `/auth/me`; `null` = không thuộc công ty / quá `access_until` (⇒ 401 SESSION_REVOKED). */
  meOf(userId: string): Promise<MeCompanyView | null>;
  /** `admin:bootstrap` (CLI) — một transaction, khóa `company:admins`. */
  bootstrapAdmin(input: BootstrapAdminInput): Promise<BootstrapAdminResult>;
  /** Router `/api/v1/hr` (thêm nhân viên — T-061; phần còn lại T-062). */
  hrRoutes(authenticate: RequestHandler): Router;
  /** Cổng công ty cho auth (`ICompanySessionGate`, khớp cấu trúc). */
  sessionGate: {
    isActive(userId: string): Promise<boolean>;
    meOf(userId: string): Promise<MeCompanyView | null>;
    companyName(): Promise<string | null>;
  };
  /** `INotificationAudience` của notifications (khớp cấu trúc — ADR-093). */
  notificationAudience: {
    accessOf(userId: string): Promise<{ since: Date; canManageHr: boolean } | null>;
    hrRecipients(): Promise<string[]>;
  };
}

/** Composition của module company (Mốc 3.5, ADR-133…137). Route admin / hr ở các vé T-061 / T-062 sau. */
export function createCompanyModule(d: CompanyModuleDeps): CompanyModule {
  const { members, tenures, hrAudit } = d.repos;
  const { clock, ids } = d;
  const access = new CompanyAccess({ members, clock });
  const audit = new HrAuditWriter({ hrAudit, ids, clock });
  const accounts: ICompanyAccounts = {
    findByEmail: (email) => accountsOf().findByEmail(email),
    findById: (userId) => accountsOf().findById(userId),
    profiles: (userIds) => accountsOf().profiles(userIds),
    revokeSessions: (userId, reason) => accountsOf().revokeSessions(userId, reason),
    createPending: (input) => accountsOf().createPending(input),
    issueActivation: (input) => accountsOf().issueActivation(input),
  };
  function accountsOf(): ICompanyAccounts {
    if (!d.accounts.current) throw new Error('company: chưa nối port tài khoản (composition)');
    return d.accounts.current;
  }
  const hire = new HireEmployeeUseCase({
    access,
    members,
    tenures,
    accounts,
    audit,
    uow: d.uow,
    clock,
    timeZone: d.timeZone ?? (() => Promise.resolve(DEFAULT_COMPANY_TIME_ZONE)),
    logger: d.logger,
  });
  const active = async (userId: string) => {
    const m = await members.find(userId);
    return m && isCompanyAccessActive(m, clock.now()) ? m : null;
  };
  const bootstrap = new BootstrapAdminUseCase({
    company: d.repos.company,
    members,
    accounts,
    audit,
    uow: d.uow,
    ids,
    clock,
    timeZone: d.timeZone ?? (() => Promise.resolve(DEFAULT_COMPANY_TIME_ZONE)),
  });
  const meOf = async (userId: string): Promise<MeCompanyView | null> => {
    const m = await active(userId);
    if (!m) return null;
    const company = await d.repos.company.get();
    return {
      name: company?.name ?? null,
      role: m.role,
      grants: [...m.grants],
      permissions: [...effectiveCompanyPermissions(m.role, m.grants)].sort(),
      status: m.offboardLastDay === null ? 'ACTIVE' : 'OFFBOARDING',
      offboardLastDay: m.offboardLastDay,
    };
  };
  return {
    access,
    tenures,
    members,
    hrAudit: audit,
    bootstrapAdmin: (input) => bootstrap.execute(input),
    hrRoutes: (authenticate) =>
      hrRoutes({
        controller: new HrController({ hire, responder: d.responder }),
        authenticate,
        limit: d.limit,
      }),
    sessionGate: {
      isActive: async (userId) => (await active(userId)) !== null,
      meOf,
      companyName: async () => (await d.repos.company.get())?.name ?? null,
    },
    async permissionsOf(userId) {
      const m = await active(userId);
      return m ? effectiveCompanyPermissions(m.role, m.grants) : null;
    },
    meOf,
    notificationAudience: {
      async accessOf(userId) {
        const m = await active(userId);
        if (!m) return null;
        return {
          since: m.createdAt,
          canManageHr: effectiveCompanyPermissions(m.role, m.grants).has('hr:manage'),
        };
      },
      async hrRecipients() {
        const now = clock.now();
        return (await members.listHrManagerCandidates())
          .filter((m) => isCompanyAccessActive(m, now))
          .map((m) => m.userId);
      },
    },
  };
}
