import type { UserRefDto } from '@taskflow/contracts';

import type {
  EmployeeKey,
  ILeaveEmployeeDirectory,
} from '../../../application/ports/leave-read-model.port';
import type { DbProvider } from './db';

/**
 * Nhân viên hiện tại (OWNER/PM/MEMBER — khớp `HrAccess.isEmployee` của T-037) đọc thẳng `workspace_members` JOIN
 * `users` (CQRS-lite, như read model task). Keyset (fullName, id) tăng dần.
 */
export class PrismaLeaveEmployeeDirectory implements ILeaveEmployeeDirectory {
  constructor(private readonly db: DbProvider) {}

  async listEmployees(
    workspaceId: string,
    after: EmployeeKey | null,
    limit: number,
  ): Promise<UserRefDto[]> {
    const rows = await this.db().workspaceMember.findMany({
      where: {
        workspaceId,
        role: { in: ['OWNER', 'PM', 'MEMBER'] },
        ...(after
          ? {
              user: {
                OR: [
                  { fullName: { gt: after.fullName } },
                  { fullName: after.fullName, id: { gt: after.id } },
                ],
              },
            }
          : {}),
      },
      select: { user: { select: { id: true, fullName: true } } },
      orderBy: [{ user: { fullName: 'asc' } }, { user: { id: 'asc' } }],
      take: limit,
    });
    return rows.map((r) => r.user);
  }
}
