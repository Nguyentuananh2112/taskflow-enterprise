import { ListHrAuditLogsQuery as ListHrAuditLogsQuerySchema } from '@taskflow/contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';

import type { HttpResponder } from '../../../core/http/envelope';
import { afterFromCursor, pageMeta } from '../../../core/http/pagination';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type { ListHrAuditLogsQuery } from '../application/list-hr-audit-logs.query';
import type { CompanyPermission } from '../domain/roles';
import { permitCompany } from './company.routes';

/** Mount dưới `/api/v1` (container) — router riêng, không đụng router `/hr` của T-062. */
export const HR_AUDIT_PATH = '/hr/audit-logs';
const CURSOR_KIND = 'hr-audit-logs';

export class HrAuditController {
  constructor(
    private readonly d: { list: Pick<ListHrAuditLogsQuery, 'execute'>; responder: HttpResponder },
  ) {}

  list = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListHrAuditLogsQuerySchema;
    const page = await this.d.list.execute(requireUser(req).id, {
      after: afterFromCursor(CURSOR_KIND, query.cursor),
      limit: query.limit,
    });
    const items = page.items.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actorId === null ? null : { id: r.actorId, fullName: r.actorName ?? '' },
      targetUserId: r.targetUserId,
      refId: r.refId,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt,
    }));
    this.d.responder.ok(res, items, pageMeta(CURSOR_KIND, page.nextAfter, query.limit));
  };
}

/**
 * `GET /api/v1/hr/audit-logs` — CHỈ Admin (`company:admin`, ADR-136, B-L1): HR có `hr:manage` cũng 403. Thứ tự:
 * 401 → 401 SESSION_REVOKED → 403 (trước validate query) → 400 → query (chốt lại dưới khóa FOR SHARE). Mới nhất
 * trước, keyset cursor; `before` / `after` không bao giờ chứa `reason` của đơn nghỉ (B-H2, chặn ở writer).
 */
export function hrAuditRoutes(d: {
  controller: HrAuditController;
  permissionsOf: (userId: string) => Promise<ReadonlySet<CompanyPermission> | null>;
  authenticate: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}): Router {
  const router = Router();
  router.get(
    '/',
    d.authenticate,
    ...d.limit(RATE_LIMIT_RULES.authenticated),
    permitCompany(d.permissionsOf, 'company:admin'),
    validate({ query: ListHrAuditLogsQuerySchema }),
    d.controller.list,
  );
  return router;
}
