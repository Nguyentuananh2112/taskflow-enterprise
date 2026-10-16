import type { ListHrAuditLogsQuery, SetMemberGrantsBody } from '@taskflow/contracts';
import type { Request, Response } from 'express';

import type { HttpResponder } from '../../../core/http/envelope';
import { pageMeta } from '../../../core/http/pagination';
import { clientIdOf } from '../../../core/http/request-user';
import type { ListHrAuditLogsQuery as ListHrAuditLogs } from '../application/use-cases/list-hr-audit-logs.query';
import type { SetMemberGrantsUseCase } from '../application/use-cases/set-member-grants.use-case';
import { uuidAfterFromCursor } from './keyset-cursor';
import { actorOf } from './membership';

const HR_AUDIT_CURSOR = 'hr-audit-logs';

export interface HrControllerDeps {
  setGrants: Pick<SetMemberGrantsUseCase, 'execute'>;
  listAuditLogs: Pick<ListHrAuditLogs, 'execute'>;
  responder: HttpResponder;
}

/** Route nhân sự của module Workspace (T-037): grants + nhật ký HR. */
export class HrController {
  constructor(private readonly d: HrControllerDeps) {}

  setGrants = async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { grants } = req.body as SetMemberGrantsBody;
    this.d.responder.ok(
      res,
      await this.d.setGrants.execute(actorOf(req), {
        userId,
        grants,
        originClientId: clientIdOf(req),
      }),
    );
  };

  listAuditLogs = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListHrAuditLogsQuery;
    const page = await this.d.listAuditLogs.execute(actorOf(req), {
      after: uuidAfterFromCursor(HR_AUDIT_CURSOR, query.cursor),
      limit: query.limit,
    });
    const items = page.items.map((r) => ({
      id: r.id,
      action: r.action,
      actor: { id: r.actorId, fullName: r.actorName },
      targetUserId: r.targetUserId,
      refId: r.refId,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt,
    }));
    this.d.responder.ok(res, items, pageMeta(HR_AUDIT_CURSOR, page.nextAfter, query.limit));
  };
}
