import type { RequestHandler, Router } from 'express';

import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { PayrollDeps } from './application/payroll-kit';
import type { IPayrollStore } from './application/ports/payroll-store.port';
import { PayrollQueries } from './application/use-cases/payroll.queries';
import { PayrollRunsUseCases } from './application/use-cases/payroll-runs.use-cases';
import { PayslipEditsUseCases } from './application/use-cases/payslip-edits.use-cases';
import { PublishPayrollUseCase } from './application/use-cases/publish-payroll.use-case';
import { SettingsProfilesUseCases } from './application/use-cases/settings-profiles.use-cases';
import { InMemoryPayrollStore } from './infrastructure/in-memory/in-memory-payroll.store';
import { PrismaPayrollStore, type DbProvider } from './infrastructure/prisma/prisma-payroll.store';
import { PayrollController } from './presentation/payroll.controller';
import {
  PAYROLL_PATH,
  PAYSLIPS_PATH,
  payrollRoutes,
  payslipRoutes,
} from './presentation/payroll.routes';

export interface PayrollRepositories {
  store: IPayrollStore;
}

export const createPrismaPayrollRepositories = (db: DbProvider): PayrollRepositories => ({
  store: new PrismaPayrollStore(db),
});

export const createInMemoryPayrollRepositories = () => ({ store: new InMemoryPayrollStore() });

export interface PayrollModuleDeps extends Omit<PayrollDeps, 'store'> {
  repos: PayrollRepositories;
  /** Mọi người từng có nhiệm kỳ EMPLOYEE (attendance). */
  everEmployed(): Promise<string[]>;
  /** Quyền công ty hiện tại (company `permissionsOf`) — chặn route trước validate. */
  permissionsOf(userId: string): Promise<ReadonlySet<string> | null>;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

export interface PayrollModule {
  routers(authenticate: RequestHandler): { path: string; router: Router }[];
}

/** Composition của module lương (Mốc 4, payroll.md v4 — T-049). */
export function createPayrollModule(m: PayrollModuleDeps): PayrollModule {
  const d: PayrollDeps = { ...m, store: m.repos.store };
  const controller = new PayrollController({
    settings: new SettingsProfilesUseCases({ ...d, everEmployed: () => m.everEmployed() }),
    runs: new PayrollRunsUseCases(d),
    publish: new PublishPayrollUseCase(d),
    edits: new PayslipEditsUseCases(d),
    queries: new PayrollQueries(d),
    store: d.store,
    responder: m.responder,
  });
  return {
    routers: (authenticate) => {
      const routeDeps = {
        controller,
        authenticate,
        limit: m.limit,
        permissionsOf: (userId: string) => m.permissionsOf(userId),
      };
      return [
        { path: PAYROLL_PATH, router: payrollRoutes(routeDeps) },
        { path: PAYSLIPS_PATH, router: payslipRoutes(routeDeps) },
      ];
    },
  };
}
