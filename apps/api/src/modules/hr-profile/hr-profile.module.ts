import type { RequestHandler, Router } from 'express';

import type { IClock } from '../../core/domain';
import type { LocalDate } from '../../core/domain/local-time';
import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { ILogger } from '../../core/logging/logger';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import { HireProfileHooks } from './application/hire-profile';
import type {
  IEmployeeProfileRepository,
  IProfileAccess,
  IProfileAudit,
  IProfileLeaveBalances,
  IProfileLocks,
  IProfileNotifier,
  IProfilePeople,
} from './application/ports/employee-profile.port';
import { ProfileWriter } from './application/profile-writer';
import {
  EmployeeProfileQueries,
  PutEmployeeProfileUseCase,
} from './application/use-cases/employee-profile.use-cases';
import {
  HR_PROFILE_PATH,
  HrProfileController,
  hrProfileRoutes,
} from './presentation/hr-profile.routes';

export interface HrProfileRepositories {
  profiles: IEmployeeProfileRepository;
  locks: IProfileLocks;
}

export interface HrProfileModuleDeps {
  repos: HrProfileRepositories;
  /** Module company (dựng TRƯỚC) — quyền, luật self, người từng là EMPLOYEE, audit HR. */
  access: IProfileAccess;
  people: IProfilePeople;
  audit: IProfileAudit;
  /** Publisher của notifications. */
  notifier: IProfileNotifier;
  /** Leave (D, T-057) — đọc trễ; trước khi nối: `[]`. */
  leaveBalances: () => IProfileLeaveBalances;
  uow: IUnitOfWork;
  /** Giờ NGHIỆP VỤ. */
  clock: IClock;
  timeZone: () => Promise<string>;
  logger: ILogger;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

export interface HrProfileModule {
  routers(authenticate: RequestHandler): { path: string; router: Router }[];
  /** Phần hồ sơ của `POST hr/employees` (company gọi trong transaction thêm nhân viên). */
  hire: HireProfileHooks;
  /** Cột hồ sơ của danh sách `/hr/employees` (không `workPhone`). */
  columnsOf(
    userIds: readonly string[],
  ): Promise<
    ReadonlyMap<
      string,
      { hireDate: LocalDate | null; department: string | null; jobTitle: string | null }
    >
  >;
  /** Port `hireDates` của leave / payroll (ADR-128): người chưa có hồ sơ ⇒ `null`. */
  hireDates(query: { userIds: readonly string[] }): Promise<Map<string, LocalDate | null>>;
}

/** Hồ sơ nhân viên cấp công ty (Mốc 5, T-054 — hr-extended ADR-128). */
export function createHrProfileModule(d: HrProfileModuleDeps): HrProfileModule {
  const { profiles, locks } = d.repos;
  const writer = new ProfileWriter({ profiles, audit: d.audit, clock: d.clock });
  const leaveBalances: IProfileLeaveBalances = {
    negativeBalancesIfHireDate: (q) => d.leaveBalances().negativeBalancesIfHireDate(q),
  };
  const deps = { ...d, profiles, locks, writer, leaveBalances };
  const queries = new EmployeeProfileQueries(deps);
  const put = new PutEmployeeProfileUseCase(deps);
  return {
    routers: (authenticate) => [
      {
        path: HR_PROFILE_PATH,
        router: hrProfileRoutes({
          controller: new HrProfileController({ queries, put, responder: d.responder }),
          authenticate,
          limit: d.limit,
          permissionsOf: (userId) => d.access.permissionsOf(userId),
        }),
      },
    ],
    hire: new HireProfileHooks({ profiles, locks, writer }),
    async columnsOf(userIds) {
      const rows = await profiles.findMany(userIds);
      return new Map(
        [...rows].map(([id, p]) => [
          id,
          { hireDate: p.hireDate, department: p.department, jobTitle: p.jobTitle },
        ]),
      );
    },
    async hireDates({ userIds }) {
      const rows = await profiles.findMany(userIds);
      return new Map(userIds.map((id) => [id, rows.get(id)?.hireDate ?? null]));
    },
  };
}

/** Chưa nối leave (trước T-057): không có phép âm. */
export const NO_NEGATIVE_BALANCES: IProfileLeaveBalances = {
  negativeBalancesIfHireDate: () => Promise.resolve([]),
};
