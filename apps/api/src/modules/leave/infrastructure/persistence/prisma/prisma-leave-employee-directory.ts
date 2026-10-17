import type { UserRefDto } from '@taskflow/contracts';

import type {
  EmployeeKey,
  ILeaveEmployeeDirectory,
} from '../../../application/ports/leave-read-model.port';
import type { DbProvider } from './db';

/**
 * Nhân viên hiện tại của công ty — `company_members.role = 'EMPLOYEE'` (đang làm, chờ kích hoạt, sắp nghỉ; D M3) —
 * đọc thẳng `company_members` JOIN `users` (CQRS-lite, như read model task). Admin không có. Keyset (fullName, id)
 * tăng dần.
 */
export class PrismaLeaveEmployeeDirectory implements ILeaveEmployeeDirectory {
  constructor(private readonly db: DbProvider) {}

  async listEmployees(after: EmployeeKey | null, limit: number): Promise<UserRefDto[]> {
    const rows = await this.db().companyMember.findMany({
      where: {
        role: 'EMPLOYEE',
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
