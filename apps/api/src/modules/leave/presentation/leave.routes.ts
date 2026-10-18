import {
  AdjustLeaveBalanceBody,
  CancelLeaveBody,
  DecideLeaveBody,
  LeaveBalanceParams,
  LeaveBalanceQuery,
  LeaveExportQuery,
  LeavePolicyParams,
  LeavePolicyQuery,
  LeavePreviewQuery,
  LeaveRequestParams,
  ListLeaveBalancesQuery,
  ListLeaveRequestsQuery,
  PutLeavePolicyBody,
  RevokeLeaveBody,
  SubmitLeaveBody,
} from '@taskflow/contracts';
import { Router, type RequestHandler } from 'express';
import type * as z from 'zod';

import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { validate } from '../../../core/http/validate';
import type { ILeaveCompany } from '../application/ports/leave.ports';
import { listPermission, permitLeave } from './leave-access';
import type { LeavePolicyController } from './leave-policy.controller';
import type { LeaveController } from './leave.controller';

export interface LeaveRouteDeps {
  controller: LeaveController;
  policy: LeavePolicyController;
  company: Pick<ILeaveCompany, 'reloadActor'>;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

/** Gắn dưới `/api/v1` (mergeParams). */
export const LEAVE_PATH = '/leave';

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
  // Gắn THEO TỪNG ROUTE (giữ từ khi router còn mount chung tiền tố với Workspace — T-028 F1); nay mount ở `/leave`.
  const base = [noStore, d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  const guard = (
    params: z.ZodType | null,
    permission: Parameters<typeof permitLeave>[1],
    input: { body?: z.ZodType; query?: z.ZodType } = {},
  ) => [
    ...base,
    ...(params ? [validate({ params })] : []),
    permitLeave(d.company, permission),
    validate(input),
  ];

  router.get(
    '/requests',
    ...guard(null, listPermission, { query: ListLeaveRequestsQuery }),
    c.list,
  );
  router.get('/requests/preview', ...guard(null, SELF, { query: LeavePreviewQuery }), c.preview);
  router.post('/requests', ...guard(null, SELF, { body: SubmitLeaveBody }), c.submit);
  router.post(
    '/requests/:requestId/cancel',
    ...guard(LeaveRequestParams, SELF, { body: CancelLeaveBody }),
    c.cancel,
  );
  router.post(
    '/requests/:requestId/approve',
    ...guard(LeaveRequestParams, HR, { body: DecideLeaveBody }),
    c.approve,
  );
  router.post(
    '/requests/:requestId/reject',
    ...guard(LeaveRequestParams, HR, { body: DecideLeaveBody }),
    c.reject,
  );
  router.post(
    '/requests/:requestId/revoke',
    ...guard(LeaveRequestParams, HR, { body: RevokeLeaveBody }),
    c.revoke,
  );
  router.get('/balances/me', ...guard(null, SELF, { query: LeaveBalanceQuery }), c.myBalance);
  router.get('/balances', ...guard(null, HR, { query: ListLeaveBalancesQuery }), c.listBalances);
  router.patch(
    '/balances/:userId/:year',
    ...guard(LeaveBalanceParams, HR, { body: AdjustLeaveBalanceBody }),
    c.adjustBalance,
  );
  // T-057 (ADR-131): chính sách phép — hr:manage TRƯỚC validate (body sai vẫn 403).
  router.get('/policy', ...guard(null, HR, { query: LeavePolicyQuery }), d.policy.get);
  router.put(
    '/policy/:year',
    ...guard(LeavePolicyParams, HR, { body: PutLeavePolicyBody }),
    d.policy.put,
  );
  // Báo cáo phép .xlsx: dùng CHUNG hạn mức xuất file 20/giờ/user với bảng công (F).
  router.get(
    '/export.xlsx',
    ...guard(null, HR, { query: LeaveExportQuery }),
    ...d.limit(RATE_LIMIT_RULES.attendanceExport),
    d.policy.exportXlsx,
  );
  return router;
}
