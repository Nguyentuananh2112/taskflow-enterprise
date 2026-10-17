import type { LocalDate } from '../../../../core/domain/local-time';
import type {
  DepartedEmployee,
  ICompanyOffboardingRepository,
} from '../../application/ports/offboarding.port';
import type { CompanyMemberSnapshot } from '../../domain/company-member';
import type { DbProvider } from './prisma-company';

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const dateOf = (d: LocalDate) => new Date(`${d}T00:00:00.000Z`);

type Row = {
  userId: string;
  role: 'ADMIN' | 'EMPLOYEE';
  grants: ('HR_MANAGE' | 'PAYROLL_MANAGE')[];
  startDate: Date | null;
  offboardLastDay: Date | null;
  offboardAccessUntil: Date | null;
  offboardScheduledById: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

const snapshotOf = (r: Row): CompanyMemberSnapshot => ({
  userId: r.userId,
  role: r.role,
  grants: r.grants,
  startDate: dateOnly(r.startDate),
  offboardLastDay: dateOnly(r.offboardLastDay),
  offboardAccessUntil: r.offboardAccessUntil,
  offboardScheduledById: r.offboardScheduledById,
  version: r.version,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** SQL thô ⇒ tên cột snake_case; đổi sang `Row`. */
type RawRow = {
  user_id: string;
  role: Row['role'];
  grants: Row['grants'];
  start_date: Date | null;
  offboard_last_day: Date | null;
  offboard_access_until: Date | null;
  offboard_scheduled_by_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};
const fromRaw = (r: RawRow): CompanyMemberSnapshot =>
  snapshotOf({
    userId: r.user_id,
    role: r.role,
    grants: r.grants,
    startDate: r.start_date,
    offboardLastDay: r.offboard_last_day,
    offboardAccessUntil: r.offboard_access_until,
    offboardScheduledById: r.offboard_scheduled_by_id,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

/** Câu UPDATE / DELETE có điều kiện — READ COMMITTED đánh giá lại WHERE sau khi chờ khóa dòng. */
export class PrismaCompanyOffboarding implements ICompanyOffboardingRepository {
  constructor(private readonly db: DbProvider) {}

  async schedule(input: Parameters<ICompanyOffboardingRepository['schedule']>[0]) {
    const rows = await this.db().companyMember.updateManyAndReturn({
      where: { userId: input.userId },
      data: {
        offboardLastDay: dateOf(input.lastDay),
        offboardAccessUntil: input.accessUntil,
        offboardScheduledById: input.scheduledById,
        version: { increment: 1 },
        updatedAt: input.at,
      },
    });
    return rows[0] ? snapshotOf(rows[0]) : null;
  }

  async cancel(userId: string, at: Date) {
    const rows = await this.db().companyMember.updateManyAndReturn({
      where: { userId, offboardLastDay: { not: null } },
      data: {
        offboardLastDay: null,
        offboardAccessUntil: null,
        offboardScheduledById: null,
        version: { increment: 1 },
        updatedAt: at,
      },
    });
    return rows[0] ? snapshotOf(rows[0]) : null;
  }

  async deleteIfDue(userId: string, now: Date) {
    const rows = await this.db().$queryRaw<RawRow[]>`
      DELETE FROM company_members
       WHERE user_id = ${userId}::uuid AND offboard_access_until <= ${now}
      RETURNING user_id, role, grants, start_date, offboard_last_day, offboard_access_until,
                offboard_scheduled_by_id, version, created_at, updated_at`;
    return rows[0] ? fromRaw(rows[0]) : null;
  }

  async listDue(now: Date, limit: number) {
    const rows = await this.db().companyMember.findMany({
      where: { offboardAccessUntil: { lte: now } },
      orderBy: [{ offboardAccessUntil: 'asc' }, { userId: 'asc' }],
      take: limit,
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async listEmployees() {
    const rows = await this.db().companyMember.findMany({ where: { role: 'EMPLOYEE' } });
    return rows.map(snapshotOf);
  }

  async listMembersByIds(userIds: readonly string[]) {
    if (userIds.length === 0) return [];
    const rows = await this.db().companyMember.findMany({
      where: { userId: { in: [...userIds] } },
    });
    return rows.map(snapshotOf);
  }

  async listDeparted(): Promise<DepartedEmployee[]> {
    const rows = await this.db().$queryRaw<{ user_id: string; first_day: Date; last_day: Date }[]>`
      SELECT DISTINCT ON (d.user_id) d.user_id, d.first_day, d.last_day
        FROM company_member_departures d
       WHERE NOT EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = d.user_id)
       ORDER BY d.user_id, d.last_day DESC`;
    return rows.map((r) => ({
      userId: r.user_id,
      firstDay: dateOnly(r.first_day)!,
      lastDay: dateOnly(r.last_day)!,
    }));
  }
}
