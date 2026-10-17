import type { Prisma } from '../../../../generated/prisma/client';
import type { CompanyMemberSnapshot } from '../../domain/company-member';

// Lệnh ghi có điều kiện của `/admin/access` (T-061a) — tách khỏi `prisma-company.ts` (giới hạn 200 dòng). Trả `true`
// khi đúng MỘT dòng đổi (điều kiện role còn đúng), bên gọi đọc lại dòng.

/** Grants mới của EMPLOYEE, `version + 1` — có điều kiện vẫn là EMPLOYEE. */
export async function updateGrants(
  db: Prisma.TransactionClient,
  userId: string,
  grants: CompanyMemberSnapshot['grants'],
  at: Date,
): Promise<boolean> {
  const { count } = await db.companyMember.updateMany({
    where: { userId, role: 'EMPLOYEE' },
    data: { grants: [...grants], version: { increment: 1 }, updatedAt: at },
  });
  return count === 1;
}

export interface DemoteInput {
  startDate: string;
  grants: CompanyMemberSnapshot['grants'];
  at: Date;
}

/** ADMIN → EMPLOYEE: nhiệm kỳ mới từ `startDate`, grants mới, `version + 1` — có điều kiện vẫn là ADMIN. */
export async function demote(
  db: Prisma.TransactionClient,
  userId: string,
  input: DemoteInput,
): Promise<boolean> {
  const { count } = await db.companyMember.updateMany({
    where: { userId, role: 'ADMIN' },
    data: {
      role: 'EMPLOYEE',
      grants: [...input.grants],
      startDate: new Date(`${input.startDate}T00:00:00.000Z`),
      version: { increment: 1 },
      updatedAt: input.at,
    },
  });
  return count === 1;
}
