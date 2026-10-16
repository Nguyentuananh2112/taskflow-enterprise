import {
  AdjustLeaveBalanceBody,
  CancelLeaveBody,
  DecideLeaveBody,
  LeaveBalanceParams,
  LeaveBalanceQuery,
  LeavePreviewQuery,
  LeaveRequestParams,
  ListLeaveBalancesQuery,
  ListLeaveRequestsQuery,
  RevokeLeaveBody,
  SubmitLeaveBody,
  WorkspaceParams,
} from '@taskflow/contracts';
import { Router, type RequestHandler } from 'express';
import type * as z from 'zod';

import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { validate } from '../../../core/http/validate';
import type { ILeaveMembership } from '../application/ports/leave.ports';
import { listPermission, permitLeave } from './leave-access';
import type { LeaveController } from './leave.controller';

export interface LeaveRouteDeps {
  controller: LeaveController;
  membership: Pick<ILeaveMembership, 'reloadActor'>;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

/** Gắn dưới `/api/v1` (mergeParams). */
export const LEAVE_PATH = '/workspaces/:wsId';

const SELF = 'leave:self';
const HR = 'hr:manage';

/**
 * Route nghỉ phép (thiết kế §5). Mỗi route: 400 params → 404 ws / 403 quyền (`permitLeave`) → 400 body/query →
 * use case. Response không cache (dữ liệu cá nhân, `reason` có thể là dữ liệu sức khỏe — B-H2).
 */
export function leaveRoutes(d: LeaveRouteDeps): Router {
  const router = Router({ mergeParams: true });
  const c = d.controller;
  const noStore: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };
  // Gắn THEO TỪNG ROUTE, không `router.use`: router này mount ở `/workspaces/:wsId` nên `use` sẽ chạy cả cho route
  // của module Workspace đi ngang qua ⇒ xác thực + đếm limiter 2 lần (cùng lỗi audit T-028 F1 của Task).
  const base = [noStore, d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  const guard = (
    params: z.ZodType,
    permission: Parameters<typeof permitLeave>[1],
    input: { body?: z.ZodType; query?: z.ZodType } = {},
  ) => [...base, validate({ params }), permitLeave(d.membership, permission), validate(input)];

  router.get(
    '/leave-requests',
    ...guard(WorkspaceParams, listPermission, { query: ListLeaveRequestsQuery }),
    c.list,
  );
  router.get(
    '/leave-requests/preview',
    ...guard(WorkspaceParams, SELF, { query: LeavePreviewQuery }),
    c.preview,
  );
  router.post(
    '/leave-requests',
    ...guard(WorkspaceParams, SELF, { body: SubmitLeaveBody }),
    c.submit,
  );
  router.post(
    '/leave-requests/:requestId/cancel',
    ...guard(LeaveRequestParams, SELF, { body: CancelLeaveBody }),
    c.cancel,
  );
  router.post(
    '/leave-requests/:requestId/approve',
    ...guard(LeaveRequestParams, HR, { body: DecideLeaveBody }),
    c.approve,
  );
  router.post(
    '/leave-requests/:requestId/reject',
    ...guard(LeaveRequestParams, HR, { body: DecideLeaveBody }),
    c.reject,
  );
  router.post(
    '/leave-requests/:requestId/revoke',
    ...guard(LeaveRequestParams, HR, { body: RevokeLeaveBody }),
    c.revoke,
  );
  router.get(
    '/leave-balances/me',
    ...guard(WorkspaceParams, SELF, { query: LeaveBalanceQuery }),
    c.myBalance,
  );
  router.get(
    '/leave-balances',
    ...guard(WorkspaceParams, HR, { query: ListLeaveBalancesQuery }),
    c.listBalances,
  );
  router.patch(
    '/leave-balances/:userId/:year',
    ...guard(LeaveBalanceParams, HR, { body: AdjustLeaveBalanceBody }),
    c.adjustBalance,
  );
  return router;
}
