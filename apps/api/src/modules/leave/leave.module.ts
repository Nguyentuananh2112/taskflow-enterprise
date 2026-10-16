import type { Router } from 'express';

import type { HttpResponder } from '../../core/http/envelope';
import type { LeaveCommandDeps } from './application/leave-commands';
import { LeaveCommands } from './application/leave-commands';
import { LeaveQueries } from './application/leave-queries';
import type {
  ILeaveEmployeeDirectory,
  ILeaveReadModel,
} from './application/ports/leave-read-model.port';
import { LeaveController } from './presentation/leave.controller';
import { leaveRoutes, type LeaveRouteDeps } from './presentation/leave.routes';

export interface LeaveModuleDeps extends LeaveCommandDeps {
  readModel: ILeaveReadModel;
  employees: ILeaveEmployeeDirectory;
  responder: HttpResponder;
  http: Pick<LeaveRouteDeps, 'authenticate' | 'limit'>;
}

/**
 * Module nghỉ phép (T-039). Mọi cộng tác viên là PORT do leave sở hữu, adapter nối ở composition root (ADR-093):
 * lịch ← attendance (T-038), membership/quyền + audit ← workspace (T-037), thông báo ← T-040, tên ← auth.
 * `approvedLeaves` là adapter cho `ApprovedLeavePort` của attendance (thiết kế §4).
 */
export function createLeaveModule(d: LeaveModuleDeps): {
  router: Router;
  commands: LeaveCommands;
  queries: LeaveQueries;
  approvedLeaves: Pick<LeaveQueries, 'approvedLeaves'>;
} {
  const commands = new LeaveCommands(d);
  const queries = new LeaveQueries(d);
  const controller = new LeaveController({ commands, queries, responder: d.responder });
  const router = leaveRoutes({ controller, membership: d.membership, ...d.http });
  return { router, commands, queries, approvedLeaves: queries };
}
