import type { Router } from 'express';

import { DEFAULT_EXPORT_LIMITS, type ExportLimits } from '../../core/export/export-limits';

import type { HttpResponder } from '../../core/http/envelope';
import type { LeaveCommandDeps } from './application/leave-commands';
import { LeaveCommands } from './application/leave-commands';
import { LeaveKit } from './application/leave-kit';
import { LeaveQueries } from './application/leave-queries';
import type {
  ILeaveEmployeeDirectory,
  ILeaveReadModel,
} from './application/ports/leave-read-model.port';
import type { ILeavePolicyStore, ILeaveRepository } from './application/ports/leave.ports';
import { EmploymentLeaveHooks } from './application/use-cases/employment-hooks.use-cases';
import { LeaveController } from './presentation/leave.controller';
import { leaveRoutes, type LeaveRouteDeps } from './presentation/leave.routes';
import {
  GetLeavePolicyQuery,
  PutLeavePolicyUseCase,
} from './application/use-cases/leave-policy.use-cases';
import { LeavePolicyController } from './presentation/leave-policy.controller';
import { LeaveExportUseCase } from './application/use-cases/leave-export.use-case';
import type { ExportSlots } from '../../core/export/export-slots';
import type { IReadSnapshot } from '../../core/persistence/read-snapshot';
import { LeaveCarryoverJob } from './application/use-cases/leave-carryover.job';
import type { ISpreadsheetWriter } from '../../core/export/xlsx/xlsx-writer';
import type { ILogger } from '../../core/logging/logger';

/** Lưu trữ của leave (composition root chọn bộ nhớ / Prisma). */
export interface LeaveRepositories {
  requests: ILeaveRepository;
  /** Chính sách phép (T-057). */
  policies: ILeavePolicyStore;
  readModel: ILeaveReadModel;
  employees: ILeaveEmployeeDirectory;
}

export interface LeaveModuleDeps extends LeaveCommandDeps {
  readModel: ILeaveReadModel;
  /** Bộ ghi .xlsx (core, ADR-130) — báo cáo phép. */
  spreadsheet: ISpreadsheetWriter;
  /** Snapshot đọc nhất quán + suất export đồng thời (T-055y) + trần / nhịp đọc (T-055 `exportLimits`). */
  readSnapshot: IReadSnapshot;
  exportSlots: ExportSlots;
  exportLimits?: ExportLimits | undefined;
  logger: ILogger;
  employees: ILeaveEmployeeDirectory;
  responder: HttpResponder;
  http: Pick<LeaveRouteDeps, 'authenticate' | 'limit'>;
}

/**
 * Module nghỉ phép (T-039). Mọi cộng tác viên là PORT do leave sở hữu, adapter nối ở composition root (ADR-093):
 * lịch ← attendance, quyền / nhân viên / nhiệm kỳ + audit ← company (T-061), thông báo ← notifications, tên ← auth.
 * `approvedLeaves` là adapter cho `ApprovedLeavePort` của attendance (thiết kế §4).
 */
export function createLeaveModule(d: LeaveModuleDeps): {
  router: Router;
  commands: LeaveCommands;
  queries: LeaveQueries;
  approvedLeaves: Pick<LeaveQueries, 'approvedLeaves'>;
  /** `ILeaveSummaryReader` của notifications (T-040b) — chỉ loại + ngày, không reason. */
  summaries: Pick<ILeaveReadModel, 'leaveSummaries'>;
  /** Port vòng đời nhân viên cho company (T-062): dọn đơn khi nghỉ việc / nâng Admin, reset khi nhận lại. */
  employment: EmploymentLeaveHooks;
  /** Job `leave-carryover` (T-057) — composition đăng ký vào MaintenanceScheduler. */
  carryover: LeaveCarryoverJob;
} {
  const commands = new LeaveCommands(d);
  const queries = new LeaveQueries(d);
  const controller = new LeaveController({ commands, queries, responder: d.responder });
  const kit = new LeaveKit(d);
  const policy = new LeavePolicyController({
    get: new GetLeavePolicyQuery(kit),
    put: new PutLeavePolicyUseCase(kit, d.readModel, d.employees),
    exporter: new LeaveExportUseCase(kit, d.readModel, d.employees, {
      snapshot: d.readSnapshot,
      slots: d.exportSlots,
      limits: d.exportLimits ?? DEFAULT_EXPORT_LIMITS,
    }),
    spreadsheet: d.spreadsheet,
    responder: d.responder,
  });
  const router = leaveRoutes({ controller, policy, company: d.company, ...d.http });
  return {
    router,
    commands,
    queries,
    approvedLeaves: queries,
    summaries: d.readModel,
    employment: new EmploymentLeaveHooks(kit, d.readModel),
    carryover: new LeaveCarryoverJob(kit, d.employees, d.logger),
  };
}
