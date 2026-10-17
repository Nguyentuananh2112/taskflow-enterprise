import type { Router } from 'express';

import type { HttpResponder } from '../../core/http/envelope';
import type { LeaveCommandDeps } from './application/leave-commands';
import { LeaveCommands } from './application/leave-commands';
import { LeaveKit } from './application/leave-kit';
import { LeaveQueries } from './application/leave-queries';
import type {
  ILeaveEmployeeDirectory,
  ILeaveReadModel,
} from './application/ports/leave-read-model.port';
import type { ILeaveRepository } from './application/ports/leave.ports';
import { EmploymentLeaveHooks } from './application/use-cases/employment-hooks.use-cases';
import { LeaveController } from './presentation/leave.controller';
import { leaveRoutes, type LeaveRouteDeps } from './presentation/leave.routes';

/** Lưu trữ của leave (composition root chọn bộ nhớ / Prisma). */
export interface LeaveRepositories {
  requests: ILeaveRepository;
  readModel: ILeaveReadModel;
  employees: ILeaveEmployeeDirectory;
}

export interface LeaveModuleDeps extends LeaveCommandDeps {
  readModel: ILeaveReadModel;
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
} {
  const commands = new LeaveCommands(d);
  const queries = new LeaveQueries(d);
  const controller = new LeaveController({ commands, queries, responder: d.responder });
  const router = leaveRoutes({ controller, company: d.company, ...d.http });
  return {
    router,
    commands,
    queries,
    approvedLeaves: queries,
    summaries: d.readModel,
    employment: new EmploymentLeaveHooks(new LeaveKit(d)),
  };
}
