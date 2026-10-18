import {
  CreatePayslipRevisionBody,
  CreateSalaryProfileVersionBody,
  MyPayslipParams,
  MyPayslipRevisionParams,
  PayrollPeriodParams,
  PayslipParams,
  PublishPayrollBody,
  PutPayrollSettingsBody,
  PutPayslipBody,
  SalaryProfileParams,
} from '@taskflow/contracts/payroll';
import { Router, type RequestHandler } from 'express';

import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import {
  EXPORT_RATE_LIMIT,
  RATE_LIMIT_RULES,
  type RateLimitRule,
} from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type { PayrollController } from './payroll.controller';

export const PAYROLL_PATH = '/payroll';
export const PAYSLIPS_PATH = '/payslips';

type PermissionsOf = (userId: string) => Promise<ReadonlySet<string> | null>;

/** Như `permitCompany`: 401 SESSION_REVOKED → 403, chạy TRƯỚC validate (ADR-135 — body sai vẫn 403). */
function permit(
  permissionsOf: PermissionsOf,
  permission: 'payroll:manage' | 'payslip:self',
): RequestHandler {
  return async (req, _res, next) => {
    const permissions = await permissionsOf(requireUser(req).id);
    if (!permissions) throw new SessionRevokedError();
    if (!permissions.has(permission)) throw new ForbiddenError(permission);
    next();
  };
}

/** Lương là dữ liệu cá nhân nhạy cảm — không cache ở đâu cả. */
const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

interface RouteDeps {
  controller: PayrollController;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  permissionsOf: PermissionsOf;
}

/** `/payroll/*` — Kế toán + Admin (`payroll:manage`). Thứ tự: authenticate → hạn mức → quyền → validate. */
export function payrollRoutes(d: RouteDeps): Router {
  const router = Router();
  const c = d.controller;
  const m = [
    d.authenticate,
    ...d.limit(RATE_LIMIT_RULES.authenticated),
    permit(d.permissionsOf, 'payroll:manage'),
  ];
  const run = { params: PayrollPeriodParams };
  router.use(noStore);
  router.get('/settings', ...m, c.getSettings);
  router.put('/settings', ...m, validate({ body: PutPayrollSettingsBody }), c.putSettings);
  router.get('/salary-profiles', ...m, c.listProfiles);
  router.post(
    '/salary-profiles/:userId',
    ...m,
    validate({ params: SalaryProfileParams, body: CreateSalaryProfileVersionBody }),
    c.createProfile,
  );
  router.get('/runs', ...m, c.listRuns);
  router.get('/runs/:period', ...m, validate(run), c.getRun);
  router.post('/runs/:period', ...m, validate(run), c.createRun);
  // ADR-130: chung bucket hạn mức export (EXPORT_RATE_LIMIT) với bảng công / phép; suất đồng thời + 422 + audit ở use case.
  router.get(
    '/runs/:period/export.xlsx',
    ...m,
    validate(run),
    ...d.limit(EXPORT_RATE_LIMIT),
    c.exportXlsx,
  );
  router.post('/runs/:period/recalculate/preview', ...m, validate(run), c.previewRecalculate);
  router.post('/runs/:period/recalculate', ...m, validate(run), c.recalculate);
  router.post('/runs/:period/add-missing', ...m, validate(run), c.addMissing);
  router.post(
    '/runs/:period/publish',
    ...m,
    validate({ ...run, body: PublishPayrollBody }),
    c.publish,
  );
  router.get(
    '/runs/:period/payslips/:userId',
    ...m,
    validate({ params: PayslipParams }),
    c.getPayslip,
  );
  router.put(
    '/runs/:period/payslips/:userId',
    ...m,
    validate({ params: PayslipParams, body: PutPayslipBody }),
    c.putPayslip,
  );
  router.post(
    '/runs/:period/payslips/:userId/revisions',
    ...m,
    validate({ params: PayslipParams, body: CreatePayslipRevisionBody }),
    c.revisePayslip,
  );
  return router;
}

/** `/payslips/*` — chỉ nhân viên (`payslip:self`; Admin ⇒ 403), chỉ phiếu của chính mình. */
export function payslipRoutes(d: RouteDeps): Router {
  const router = Router();
  const c = d.controller;
  const me = [
    d.authenticate,
    ...d.limit(RATE_LIMIT_RULES.authenticated),
    permit(d.permissionsOf, 'payslip:self'),
  ];
  router.use(noStore);
  router.get('/', ...me, c.myPayslips);
  router.get('/:period', ...me, validate({ params: MyPayslipParams }), c.myPayslip);
  router.get(
    '/:period/revisions/:revision',
    ...me,
    validate({ params: MyPayslipRevisionParams }),
    c.myPayslipRevision,
  );
  return router;
}
