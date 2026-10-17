import { EmployeeProfileParams, PutEmployeeProfileBody } from '@taskflow/contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';

import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import type { HttpResponder } from '../../../core/http/envelope';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type {
  EmployeeProfileQueries,
  PutEmployeeProfileUseCase,
} from '../application/use-cases/employee-profile.use-cases';

/** Mount dưới `/api/v1` (container) — sau router `/hr` của company. */
export const HR_PROFILE_PATH = '/hr/employee-profiles';

type PermissionsOf = (userId: string) => Promise<ReadonlySet<string> | null>;

/** Như `permitCompany` của company: 401 SESSION_REVOKED → 403, chạy TRƯỚC validate (ADR-135). */
function permit(
  permissionsOf: PermissionsOf,
  permission: 'hr:manage' | 'profile:self',
): RequestHandler {
  return async (req, _res, next) => {
    const permissions = await permissionsOf(requireUser(req).id);
    if (!permissions) throw new SessionRevokedError();
    if (!permissions.has(permission)) throw new ForbiddenError(permission);
    next();
  };
}

/** Dữ liệu nhân sự — không cache ở đâu cả (như `/hr`). */
const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

export class HrProfileController {
  constructor(
    private readonly d: {
      queries: Pick<EmployeeProfileQueries, 'get' | 'me' | 'suggestions'>;
      put: Pick<PutEmployeeProfileUseCase, 'execute'>;
      responder: HttpResponder;
    },
  ) {}

  me = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.queries.me(requireUser(req).id));
  };

  suggestions = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.queries.suggestions(requireUser(req).id));
  };

  get = async (req: Request, res: Response) => {
    const { userId } = req.params as EmployeeProfileParams;
    this.d.responder.ok(res, await this.d.queries.get(requireUser(req).id, userId));
  };

  put = async (req: Request, res: Response) => {
    const { userId } = req.params as EmployeeProfileParams;
    const { expectedVersion, reason, ...patch } = req.body as PutEmployeeProfileBody;
    const result = await this.d.put.execute({
      actorId: requireUser(req).id,
      userId,
      patch,
      expectedVersion,
      reason,
    });
    this.d.responder.ok(res, result);
  };
}

/**
 * `/api/v1/hr/employee-profiles` (T-054, ADR-128). `/me` và `/departments` khai báo TRƯỚC `/:userId` (B-MEDIUM-2 —
 * không thì `me` rơi vào validate uuid ⇒ 400). Thứ tự: authenticate → hạn mức → quyền → validate → use case.
 */
export function hrProfileRoutes(d: {
  controller: HrProfileController;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  permissionsOf: PermissionsOf;
}): Router {
  const router = Router();
  const c = d.controller;
  const base = [d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  const hr = [...base, permit(d.permissionsOf, 'hr:manage')];
  router.use(noStore);
  router.get('/me', ...base, permit(d.permissionsOf, 'profile:self'), c.me);
  router.get('/departments', ...hr, c.suggestions);
  router.get('/:userId', ...hr, validate({ params: EmployeeProfileParams }), c.get);
  router.put(
    '/:userId',
    ...hr,
    validate({ params: EmployeeProfileParams, body: PutEmployeeProfileBody }),
    c.put,
  );
  return router;
}
