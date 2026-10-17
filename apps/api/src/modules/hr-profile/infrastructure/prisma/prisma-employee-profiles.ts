import type { LocalDate } from '../../../../core/domain/local-time';
import type { Prisma } from '../../../../generated/prisma/client';
import type {
  IEmployeeProfileRepository,
  IProfileLocks,
} from '../../application/ports/employee-profile.port';
import type { EmployeeProfileSnapshot, ProfileFields } from '../../domain/employee-profile';

/** = `uow.db()` của `PrismaUnitOfWork` — repository không tự mở transaction (ADR-012). */
export type DbProvider = () => Prisma.TransactionClient;

type Row = {
  userId: string;
  hireDate: Date | null;
  department: string | null;
  jobTitle: string | null;
  workPhone: string | null;
  version: number;
  updatedById: string;
  updatedAt: Date;
};

const toDate = (d: LocalDate | null) => (d ? new Date(`${d}T00:00:00.000Z`) : null);
const toSnapshot = (r: Row): EmployeeProfileSnapshot => ({
  userId: r.userId,
  hireDate: r.hireDate ? r.hireDate.toISOString().slice(0, 10) : null,
  department: r.department,
  jobTitle: r.jobTitle,
  workPhone: r.workPhone,
  version: r.version,
  updatedById: r.updatedById,
  updatedAt: r.updatedAt,
});
const dataOf = (f: ProfileFields) => ({
  hireDate: toDate(f.hireDate),
  department: f.department,
  jobTitle: f.jobTitle,
  workPhone: f.workPhone,
});
const select = {
  userId: true,
  hireDate: true,
  department: true,
  jobTitle: true,
  workPhone: true,
  version: true,
  updatedById: true,
  updatedAt: true,
} as const;

/** `employee_profiles` (migration 6, ADR-128) + khóa advisory của lệnh đụng `hireDate` (bảng ADR-136). */
export class PrismaEmployeeProfiles implements IEmployeeProfileRepository, IProfileLocks {
  constructor(private readonly db: DbProvider) {}

  async find(userId: string): Promise<EmployeeProfileSnapshot | null> {
    const row = await this.db().employeeProfile.findUnique({ where: { userId }, select });
    return row ? toSnapshot(row) : null;
  }

  async findForUpdate(userId: string): Promise<EmployeeProfileSnapshot | null> {
    const [row] = await this.db().$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM employee_profiles WHERE user_id = ${userId}::uuid FOR UPDATE`;
    return row ? this.find(userId) : null;
  }

  async findMany(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, EmployeeProfileSnapshot>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db().employeeProfile.findMany({
      where: { userId: { in: [...userIds] } },
      select,
    });
    return new Map(rows.map((r) => [r.userId, toSnapshot(r)]));
  }

  async save(input: {
    userId: string;
    fields: ProfileFields;
    expectedVersion: number;
    updatedById: string;
    at: Date;
  }): Promise<EmployeeProfileSnapshot | null> {
    if (input.expectedVersion === 0) {
      // Đua hai lần tạo (cả hai `expectedVersion 0`): `ON CONFLICT DO NOTHING` ⇒ `[]` ⇒ 409 ở application. Không
      // bắt lỗi PK: lỗi đó hủy cả transaction Postgres, câu sau (đọc bản hiện tại) không chạy được.
      const [row] = await this.db().employeeProfile.createManyAndReturn({
        data: [
          {
            userId: input.userId,
            ...dataOf(input.fields),
            updatedById: input.updatedById,
            createdAt: input.at,
            updatedAt: input.at,
          },
        ],
        skipDuplicates: true,
        select,
      });
      return row ? toSnapshot(row) : null;
    }
    const [row] = await this.db().employeeProfile.updateManyAndReturn({
      where: { userId: input.userId, version: input.expectedVersion },
      data: {
        ...dataOf(input.fields),
        version: { increment: 1 },
        updatedById: input.updatedById,
        updatedAt: input.at,
      },
      select,
    });
    return row ? toSnapshot(row) : null;
  }

  async suggestions(): Promise<{ departments: string[]; jobTitles: string[] }> {
    const [departments, jobTitles] = await Promise.all([
      this.db().employeeProfile.findMany({
        where: { department: { not: null } },
        distinct: ['department'],
        select: { department: true },
      }),
      this.db().employeeProfile.findMany({
        where: { jobTitle: { not: null } },
        distinct: ['jobTitle'],
        select: { jobTitle: true },
      }),
    ]);
    const collator = new Intl.Collator('vi', { sensitivity: 'base' });
    return {
      departments: departments
        .flatMap((r) => (r.department ? [r.department] : []))
        .sort(collator.compare),
      jobTitles: jobTitles.flatMap((r) => (r.jobTitle ? [r.jobTitle] : [])).sort(collator.compare),
    };
  }

  /** Cùng chuỗi + hàm băm với leave (D, T-057): bản SHARED — `PUT leave/policy` lấy bản độc quyền. */
  async lockLeavePolicyShared(): Promise<void> {
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock_shared(hashtextextended(${'taskflow:leave-policy'}, 0))`;
  }

  async lockLeave(userId: string): Promise<void> {
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`taskflow:leave:${userId}`}, 0))`;
  }
}

/**
 * D8 (hr-extended §R27): xóa hồ sơ khi người đó KHÔNG còn dòng `company_members` VÀ không còn nhiệm kỳ đã đóng nào
 * có `last_day ≥ cutoffDate` (mốc D5). Chạy TRƯỚC bước D5 (D5 xóa departure ⇒ mất căn cứ giữ). `SKIP LOCKED`: hồ sơ
 * đang được sửa / nhận lại (FOR UPDATE) để lượt sau.
 */
export class PrismaEmployeeProfileRetention {
  constructor(private readonly db: DbProvider) {}

  deleteProfiles(cutoffDate: string, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM employee_profiles WHERE user_id IN (
        SELECT p.user_id FROM employee_profiles p
         WHERE NOT EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = p.user_id)
           AND NOT EXISTS (
             SELECT 1 FROM company_member_departures d
              WHERE d.user_id = p.user_id AND d.last_day >= ${cutoffDate}::date)
         ORDER BY p.updated_at
         LIMIT ${limit}
         FOR UPDATE OF p SKIP LOCKED
      )`;
  }
}
