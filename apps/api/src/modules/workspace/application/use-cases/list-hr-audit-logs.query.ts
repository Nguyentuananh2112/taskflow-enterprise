import type { HrAuditRow, IHrAuditLog } from '../ports/hr-audit.port';
import type { Page } from '../ports/queries.port';
import { requirePermission, type Actor } from '../workspace-shared';
import { pageLimit } from './list-members.query';

/**
 * `GET /workspaces/:wsId/hr-audit-logs` — CHỈ OWNER (B-L1): quyền `hr:grant` (không grant nào mở
 * được — B-M1), nên HR có `hr:manage` cũng 403. Mới nhất trước.
 */
export class ListHrAuditLogsQuery {
  constructor(private readonly d: { hrAudit: IHrAuditLog }) {}

  async execute(
    actor: Actor,
    input: { after?: string | undefined; limit?: number },
  ): Promise<Page<HrAuditRow>> {
    requirePermission(actor, 'hr:grant');
    return this.d.hrAudit.list(actor.workspaceId, {
      after: input.after,
      limit: pageLimit(input.limit),
    });
  }
}
