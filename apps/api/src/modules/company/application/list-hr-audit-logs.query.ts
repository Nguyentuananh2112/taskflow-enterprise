import type { CompanyAccess } from './company-access';
import type { AuditPage, IHrAuditLog } from './ports/hr-audit.port';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * `GET /hr/audit-logs` — CHỈ Admin (`company:admin`, ADR-136): HR có `hr:manage` cũng 403 (B-L1). Mới nhất
 * trước. Quyền đọc lại từ DB (không tin token) qua `CompanyAccess`.
 */
export class ListHrAuditLogsQuery {
  constructor(
    private readonly d: { hrAudit: IHrAuditLog; access: Pick<CompanyAccess, 'authorizeWrite'> },
  ) {}

  async execute(
    actorId: string,
    input: { after?: string | undefined; limit?: number | undefined },
  ): Promise<AuditPage> {
    await this.d.access.authorizeWrite({ actorId, permission: 'company:admin' });
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    return this.d.hrAudit.list({ after: input.after, limit });
  }
}
