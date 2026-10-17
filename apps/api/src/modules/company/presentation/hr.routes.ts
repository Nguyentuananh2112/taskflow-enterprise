import { HireEmployeeBody } from '@taskflow/contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';

import type { HttpResponder } from '../../../core/http/envelope';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type { HireEmployeeUseCase } from '../application/use-cases/hire-employee.use-case';

/** Mount dưới `/api/v1` (container). */
export const HR_PATH = '/hr';

/** Response chứa token kích hoạt — không cache ở đâu cả (ADR-137 điều 1). */
const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

export class HrController {
  constructor(
    private readonly d: { hire: Pick<HireEmployeeUseCase, 'execute'>; responder: HttpResponder },
  ) {}

  hire = async (req: Request, res: Response) => {
    const body = req.body as HireEmployeeBody;
    const result = await this.d.hire.execute({ ...body, actorId: requireUser(req).id });
    this.d.responder.created(res, {
      ...result,
      activation: result.activation
        ? { ...result.activation, expiresAt: result.activation.expiresAt.toISOString() }
        : null,
    });
  };
}

/**
 * `/api/v1/hr` (Mốc 3.5). Thứ tự: authenticate → hạn mức → validate → use case (kiểm `hr:manage` dưới khóa
 * FOR SHARE: không thuộc công ty 401 SESSION_REVOKED, thiếu quyền 403). Danh sách / nghỉ việc / tạo lại link:
 * T-062.
 */
export function hrRoutes(d: {
  controller: HrController;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}): Router {
  const router = Router();
  const c = d.controller;
  const authed = [d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  router.use(noStore);
  router.post(
    '/employees',
    ...authed,
    ...d.limit(RATE_LIMIT_RULES.hireEmployee),
    validate({ body: HireEmployeeBody }),
    c.hire,
  );
  return router;
}
