import { UpdateCompanyBody } from '@taskflow/contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';

import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import type { HttpResponder } from '../../../core/http/envelope';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type {
  GetCompanyQuery,
  RenameCompanyUseCase,
} from '../application/use-cases/company-profile.use-cases';
import type { CompanyPermission } from '../domain/roles';

/** Mount dưới `/api/v1` (container). */
export const COMPANY_PATH = '/company';

type PermissionsOf = (userId: string) => Promise<ReadonlySet<CompanyPermission> | null>;

/**
 * Chặn sớm (không khóa) để 401 / 403 đứng TRƯỚC 400 body — không lộ luật validate cho người không có quyền. Lệnh
 * ghi vẫn chốt lại dưới khóa trong use case (B-H3).
 */
export function permitCompany(
  permissionsOf: PermissionsOf,
  permission: CompanyPermission,
): RequestHandler {
  return async (req, _res, next) => {
    const perms = await permissionsOf(requireUser(req).id);
    if (perms === null) throw new SessionRevokedError();
    if (!perms.has(permission)) throw new ForbiddenError(permission);
    next();
  };
}

export class CompanyController {
  constructor(
    private readonly d: {
      get: Pick<GetCompanyQuery, 'execute'>;
      rename: Pick<RenameCompanyUseCase, 'execute'>;
      responder: HttpResponder;
    },
  ) {}

  get = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.get.execute(requireUser(req).id));
  };

  rename = async (req: Request, res: Response) => {
    const body = req.body as UpdateCompanyBody;
    this.d.responder.ok(
      res,
      await this.d.rename.execute({ ...body, actorId: requireUser(req).id }),
    );
  };
}

/** `/api/v1/company` (ADR-133/139): đọc tên cho header công ty; Admin đổi tên ở `/admin/company`. */
export function companyRoutes(d: {
  controller: CompanyController;
  permissionsOf: PermissionsOf;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}): Router {
  const router = Router();
  const c = d.controller;
  router.use(d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated));
  router.get('/', c.get);
  router.patch(
    '/',
    permitCompany(d.permissionsOf, 'company:admin'),
    validate({ body: UpdateCompanyBody }),
    c.rename,
  );
  return router;
}
