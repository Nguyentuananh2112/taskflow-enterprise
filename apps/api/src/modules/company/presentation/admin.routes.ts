import {
  AdminWorkspaceParams,
  AssignWorkspaceOwnerBody,
  EmployeeParams,
  SetAccessBody,
} from '@taskflow/contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import * as z from 'zod';

import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import type { HttpResponder } from '../../../core/http/envelope';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type { IClock, IIdGenerator } from '../../../core/domain';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import type { CompanyAccess } from '../application/company-access';
import type { HrAuditWriter } from '../application/hr-audit-writer';
import type { ICompanyAccessEvents } from '../application/ports/access-events.port';
import type { ICompanyAccounts } from '../application/ports/accounts.port';
import type { IAdminWorkspaces } from '../application/ports/admin-workspaces.port';
import type { ICompanyMemberRepository } from '../application/ports/company-member.port';
import type { IOffboardLeavePort } from '../application/ports/offboard-leave.port';
import { AdminAccessUseCases } from '../application/use-cases/admin-access.use-cases';
import { AdminWorkspacesUseCases } from '../application/use-cases/admin-workspaces.use-cases';
import type { CompanyPermission } from '../domain/roles';

/** Mount dưới `/api/v1` (container). */
export const ADMIN_PATH = '/admin';

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/**
 * Quyền công ty hiện tại (`permissionsOf` — đã áp `access_until`): không thuộc công ty ⇒ 401 `SESSION_REVOKED`, thiếu ⇒
 * 403. Chạy TRƯỚC validate (ADR-135: body sai tới route Admin ⇒ 403, không 400). Lệnh ghi còn chốt lại dưới khóa.
 */
export function permitCompany(
  permissionsOf: (userId: string) => Promise<ReadonlySet<CompanyPermission> | null>,
  permission: CompanyPermission,
): RequestHandler {
  return async (req, _res, next) => {
    const permissions = await permissionsOf(requireUser(req).id);
    if (!permissions) throw new SessionRevokedError();
    if (!permissions.has(permission)) throw new ForbiddenError(permission);
    next();
  };
}

export class AdminController {
  constructor(
    private readonly d: {
      access: Pick<AdminAccessUseCases, 'list' | 'set'>;
      workspaces: Pick<AdminWorkspacesUseCases, 'list' | 'assignOwner' | 'archive'>;
      responder: HttpResponder;
    },
  ) {}

  listAccess = async (_req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.access.list());
  };

  setAccess = async (req: Request, res: Response) => {
    const { userId } = req.params as unknown as EmployeeParams;
    const body = req.body as SetAccessBody;
    this.d.responder.ok(
      res,
      await this.d.access.set({ ...body, userId, actorId: requireUser(req).id }),
    );
  };

  listWorkspaces = async (_req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.workspaces.list());
  };

  assignOwner = async (req: Request, res: Response) => {
    const { id } = req.params as unknown as AdminWorkspaceParams;
    const { userId } = req.body as AssignWorkspaceOwnerBody;
    this.d.responder.ok(
      res,
      await this.d.workspaces.assignOwner({
        actorId: requireUser(req).id,
        workspaceId: id,
        userId,
      }),
    );
  };

  archiveWorkspace = async (req: Request, res: Response) => {
    const { id } = req.params as unknown as AdminWorkspaceParams;
    this.d.responder.ok(
      res,
      await this.d.workspaces.archive({ actorId: requireUser(req).id, workspaceId: id }),
    );
  };
}

/**
 * `/api/v1/admin` (company-level ADR-134, T-061a). Thứ tự: authenticate → hạn mức → quyền công ty → validate → use case.
 * Response có email (PII) — chỉ Admin, `no-store`.
 */
export function adminRoutes(d: {
  controller: AdminController;
  permissionsOf: (userId: string) => Promise<ReadonlySet<CompanyPermission> | null>;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}): Router {
  const router = Router();
  const c = d.controller;
  const guard = (
    permission: CompanyPermission,
    input: { params?: z.ZodType; body?: z.ZodType } = {},
  ) => [
    noStore,
    d.authenticate,
    ...d.limit(RATE_LIMIT_RULES.authenticated),
    permitCompany(d.permissionsOf, permission),
    validate(input),
  ];
  router.get('/access', ...guard('company:admin'), c.listAccess);
  router.put(
    '/access/:userId',
    ...guard('company:grant', { params: EmployeeParams, body: SetAccessBody }),
    c.setAccess,
  );
  router.get('/workspaces', ...guard('company:admin'), c.listWorkspaces);
  router.post(
    '/workspaces/:id/owner',
    ...guard('company:admin', { params: AdminWorkspaceParams, body: AssignWorkspaceOwnerBody }),
    c.assignOwner,
  );
  // Không body (POST vẫn gửi JSON — chống CSRF); thiếu body = `{}`, trường lạ ⇒ 400.
  router.post(
    '/workspaces/:id/archive',
    ...guard('company:admin', {
      params: AdminWorkspaceParams,
      body: z.strictObject({}).optional().default({}),
    }),
    c.archiveWorkspace,
  );
  return router;
}

/** Dựng use case + controller + router `/admin` (gọi từ `createCompanyModule`, giữ module dưới giới hạn dòng). */
export function createAdminRouter(d: {
  access: CompanyAccess;
  members: ICompanyMemberRepository;
  accounts: ICompanyAccounts;
  audit: HrAuditWriter;
  offboardLeave: IOffboardLeavePort;
  accessEvents: ICompanyAccessEvents;
  adminWorkspaces: () => IAdminWorkspaces;
  permissionsOf: (userId: string) => Promise<ReadonlySet<CompanyPermission> | null>;
  uow: IUnitOfWork;
  ids: IIdGenerator;
  clock: IClock;
  timeZone: () => Promise<string>;
  responder: HttpResponder;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}): Router {
  const access = new AdminAccessUseCases({ ...d, events: d.accessEvents });
  const workspaces = new AdminWorkspacesUseCases({ ...d, workspaces: d.adminWorkspaces });
  return adminRoutes({
    controller: new AdminController({ access, workspaces, responder: d.responder }),
    permissionsOf: d.permissionsOf,
    authenticate: d.authenticate,
    limit: d.limit,
  });
}
