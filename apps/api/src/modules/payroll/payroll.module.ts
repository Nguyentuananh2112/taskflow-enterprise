import type { ILogger } from '../../core/logging/logger';
import type { RequestHandler, Router } from 'express';

import type { ExportLimits } from '../../core/export/export-limits';
import type { ExportSlots } from '../../core/export/export-slots';
import type { ISpreadsheetWriter } from '../../core/export/xlsx/xlsx-writer';
import type { HttpResponder } from '../../core/http/envelope';
import type { IReadSnapshot } from '../../core/persistence/read-snapshot';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { PayrollDeps } from './application/payroll-kit';
import type { IPayrollStore } from './application/ports/payroll-store.port';
import { PayrollExportUseCase } from './application/use-cases/payroll-export.use-case';
import { PayrollQueries } from './application/use-cases/payroll.queries';
import { PayrollReminderUseCase } from './application/use-cases/payroll-reminder.use-case';
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

export const createPrismaPayrollRepositories = (
  db: DbProvider,
  logger?: Pick<ILogger, 'warn'>,
): PayrollRepositories => ({
  store: new PrismaPayrollStore(db, logger),
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
  /** Xuất .xlsx (ADR-130): snapshot đọc + suất đồng thời DÙNG CHUNG với bảng công / phép + trần T-055. */
  exports: {
    snapshot: IReadSnapshot;
    slots: Pick<ExportSlots, 'acquire'>;
    limits: ExportLimits;
    writer: ISpreadsheetWriter;
  };
}

export interface PayrollModule {
  routers(authenticate: RequestHandler): { path: string; router: Router }[];
  /** Job nhắc làm lương (maintenance) — true nếu đã gửi nhắc hôm nay. */
  remindIfDue(): Promise<boolean>;
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
    exporter: new PayrollExportUseCase({ ...d, ...m.exports }),
    writer: m.exports.writer,
    store: d.store,
    responder: m.responder,
  });
  const reminder = new PayrollReminderUseCase(d);
  return {
    remindIfDue: () => reminder.run(),
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
