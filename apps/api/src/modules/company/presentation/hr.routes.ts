import {
  EmployeeParams,
  HireEmployeeBody,
  ListEmployeesQuery,
  ScheduleOffboardingBody,
} from '@taskflow/contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import * as z from 'zod';

import { decodeCursor, encodeCursor } from '../../../core/http/cursor';
import type { HttpResponder } from '../../../core/http/envelope';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type { HireEmployeeUseCase } from '../application/use-cases/hire-employee.use-case';
import type { Employment } from '../employment.wiring';

/** Mount dưới `/api/v1` (container). */
export const HR_PATH = '/hr';
/** Cursor opaque gắn với danh sách nhân viên; khóa keyset `(fullName, userId)` validate trước khi dùng. */
const EMPLOYEES_CURSOR = 'employees';
const EmployeeCursor = z.object({ fullName: z.string().max(100), userId: z.uuid() });

/** Response chứa token kích hoạt / dữ liệu nhân sự — không cache ở đâu cả (ADR-137 điều 1). */
const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

const activationJson = (a: { token: string; link: string; expiresAt: Date }) => ({
  ...a,
  expiresAt: a.expiresAt.toISOString(),
});

export class HrController {
  constructor(
    private readonly d: {
      hire: Pick<HireEmployeeUseCase, 'execute'>;
      employment: Employment;
      responder: HttpResponder;
    },
  ) {}

  list = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListEmployeesQuery;
    const page = await this.d.employment.employees.list(requireUser(req).id, {
      status: query.status,
      q: query.q,
      after:
        query.cursor === undefined
          ? undefined
          : decodeCursor(query.cursor, EMPLOYEES_CURSOR, EmployeeCursor),
      limit: query.limit,
    });
    const next = page.nextAfter;
    this.d.responder.ok(res, page.items, {
      nextCursor: next ? encodeCursor(EMPLOYEES_CURSOR, { ...next }) : null,
      hasMore: next !== null,
      limit: query.limit,
    });
  };

  hire = async (req: Request, res: Response) => {
    const body = req.body as HireEmployeeBody;
    const result = await this.d.hire.execute({ ...body, actorId: requireUser(req).id });
    this.d.responder.created(res, {
      ...result,
      activation: result.activation ? activationJson(result.activation) : null,
    });
  };

  reissue = async (req: Request, res: Response) => {
    const { userId } = req.params as EmployeeParams;
    const activation = await this.d.employment.reissue.execute({
      actorId: requireUser(req).id,
      userId,
    });
    this.d.responder.ok(res, { activation: activationJson(activation) });
  };

  schedule = async (req: Request, res: Response) => {
    const { userId } = req.params as EmployeeParams;
    const body = req.body as ScheduleOffboardingBody;
    const result = await this.d.employment.schedule.execute({
      ...body,
      actorId: requireUser(req).id,
      userId,
    });
    this.d.responder.ok(res, {
      employee: await this.d.employment.employees.one(result.userId),
      warnings: result.warnings,
    });
  };

  cancel = async (req: Request, res: Response) => {
    const { userId } = req.params as EmployeeParams;
    await this.d.employment.cancel.execute({ actorId: requireUser(req).id, userId });
    this.d.responder.ok(res, await this.d.employment.employees.one(userId));
  };
}

/**
 * `/api/v1/hr` (Mốc 3.5). Thứ tự: authenticate → hạn mức → validate → use case (kiểm `hr:manage` dưới khóa
 * FOR SHARE: không thuộc công ty 401 SESSION_REVOKED, thiếu quyền 403; người đích lạ ⇒ 404).
 */
export function hrRoutes(d: {
  controller: HrController;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}): Router {
  const router = Router();
  const c = d.controller;
  const authed = [d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  const one = validate({ params: EmployeeParams });
  router.use(noStore);
  router.get('/employees', ...authed, validate({ query: ListEmployeesQuery }), c.list);
  router.post(
    '/employees',
    ...authed,
    ...d.limit(RATE_LIMIT_RULES.hireEmployee),
    validate({ body: HireEmployeeBody }),
    c.hire,
  );
  router.post(
    '/employees/:userId/activation-link',
    ...authed,
    ...d.limit(RATE_LIMIT_RULES.activationLink),
    one,
    c.reissue,
  );
  router.put(
    '/employees/:userId/offboarding',
    ...authed,
    validate({ params: EmployeeParams, body: ScheduleOffboardingBody }),
    c.schedule,
  );
  router.delete('/employees/:userId/offboarding', ...authed, one, c.cancel);
  return router;
}
