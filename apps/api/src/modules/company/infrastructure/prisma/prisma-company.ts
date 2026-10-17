import { ResourceConflictError } from '../../../../core/errors';
import { uniqueConstraintOf } from '../../../../core/persistence/unique-constraint';
import type { Prisma } from '../../../../generated/prisma/client';
import type {
  CompanyProfile,
  CompanyTenure,
  CompanyTenureQuery,
  ICompanyMemberRepository,
  ICompanyRepository,
  ICompanyTenureReader,
  NewCompanyMember,
} from '../../application/ports/company-member.port';
import type { CompanyMemberSnapshot } from '../../domain/company-member';
import { demote, updateGrants, type DemoteInput } from './prisma-company-roles';

/** = `uow.db()` của `PrismaUnitOfWork` — repository không tự mở transaction (ADR-012). */
export type DbProvider = () => Prisma.TransactionClient;

/** Cột DATE ⇄ `YYYY-MM-DD` (Prisma trả `Date` lúc 00:00 UTC). */
const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const byUserThenFrom = (a: CompanyTenure, b: CompanyTenure) =>
  a.userId !== b.userId
    ? a.userId < b.userId
      ? -1
      : 1
    : a.from < b.from
      ? -1
      : a.from > b.from
        ? 1
        : 0;

/** Id cố định của dòng công ty duy nhất (CHECK `companies_single_row`). */
export const COMPANY_ID = 1;

export class PrismaCompany implements ICompanyRepository {
  constructor(private readonly db: DbProvider) {}

  get(): Promise<CompanyProfile | null> {
    return this.db().company.findUnique({
      where: { id: COMPANY_ID },
      select: { name: true, version: true },
    });
  }

  async ensure(name: string, at: Date): Promise<CompanyProfile> {
    // ON CONFLICT DO NOTHING: hai bootstrap đồng thời đã tuần tự hóa bằng khóa `company:admins`, vẫn an toàn.
    await this.db().$executeRaw`
      INSERT INTO companies (id, name, version, updated_at) VALUES (${COMPANY_ID}, ${name}, 1, ${at})
      ON CONFLICT (id) DO NOTHING`;
    const row = await this.get();
    if (!row) throw new Error('companies: không đọc lại được dòng vừa tạo');
    return row;
  }
}

const toSnapshot = (r: Prisma.CompanyMemberGetPayload<object>): CompanyMemberSnapshot => ({
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

export class PrismaCompanyMembers implements ICompanyMemberRepository {
  constructor(private readonly db: DbProvider) {}

  async find(userId: string): Promise<CompanyMemberSnapshot | null> {
    const r = await this.db().companyMember.findUnique({ where: { userId } });
    return r ? toSnapshot(r) : null;
  }

  async listHrManagerCandidates(): Promise<CompanyMemberSnapshot[]> {
    const rows = await this.db().companyMember.findMany({
      where: { OR: [{ role: 'ADMIN' }, { grants: { has: 'HR_MANAGE' } }] },
      select: { userId: true },
    });
    const out: CompanyMemberSnapshot[] = [];
    for (const r of rows) {
      const m = await this.find(r.userId);
      if (m) out.push(m);
    }
    return out;
  }

  async insert(input: NewCompanyMember): Promise<CompanyMemberSnapshot> {
    try {
      await this.db().companyMember.create({
        data: {
          userId: input.userId,
          role: input.role,
          grants: input.grants,
          startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null,
          createdAt: input.at,
          updatedAt: input.at,
        },
        select: { userId: true },
      });
    } catch (err) {
      if (uniqueConstraintOf(err) === 'company_members_pkey') {
        throw new ResourceConflictError({ reason: 'already_employee', field: 'email' });
      }
      throw err;
    }
    const created = await this.find(input.userId);
    if (!created) throw new Error('company_members: dòng vừa thêm không đọc lại được');
    return created;
  }

  async hasAdmin(): Promise<boolean> {
    return (await this.db().companyMember.count({ where: { role: 'ADMIN' } })) > 0;
  }

  async listAdmins(): Promise<CompanyMemberSnapshot[]> {
    const rows = await this.db().companyMember.findMany({
      where: { role: 'ADMIN' },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    });
    const out: CompanyMemberSnapshot[] = [];
    for (const r of rows) {
      const m = await this.find(r.userId);
      if (m) out.push(m);
    }
    return out;
  }

  /** `pg_advisory_xact_lock` trả `void` — Prisma không đọc được cột void ⇒ `$executeRaw`. */
  async lockAdmins(): Promise<void> {
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${'taskflow:company:admins'}, 0))`;
  }

  async lockEmployeeWork(userId: string): Promise<void> {
    // Đúng khóa của leave (D, T-064) và attendance (A, T-063) — cùng chuỗi, cùng hàm băm.
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`taskflow:leave:${userId}`}, 0))`;
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`taskflow:attendance:punch:${userId}`}, 0))`;
  }

  async promoteToAdmin(userId: string, at: Date): Promise<CompanyMemberSnapshot | null> {
    const { count } = await this.db().companyMember.updateMany({
      where: { userId, role: 'EMPLOYEE' },
      data: {
        role: 'ADMIN',
        grants: [],
        startDate: null,
        version: { increment: 1 },
        updatedAt: at,
      },
    });
    return count === 1 ? this.find(userId) : null;
  }

  async listAll(): Promise<CompanyMemberSnapshot[]> {
    const rows = await this.db().companyMember.findMany({ orderBy: { userId: 'asc' } });
    return rows.map(toSnapshot);
  }

  async setGrants(userId: string, grants: CompanyMemberSnapshot['grants'], at: Date) {
    return (await updateGrants(this.db(), userId, grants, at)) ? this.find(userId) : null;
  }

  async demoteToEmployee(userId: string, input: DemoteInput) {
    return (await demote(this.db(), userId, input)) ? this.find(userId) : null;
  }

  async recordDeparture(d: Parameters<ICompanyMemberRepository['recordDeparture']>[0]) {
    await this.db().companyMemberDeparture.create({
      data: {
        id: d.id,
        userId: d.userId,
        role: d.role,
        firstDay: new Date(`${d.firstDay}T00:00:00.000Z`),
        lastDay: new Date(`${d.lastDay}T00:00:00.000Z`),
        leftAt: d.leftAt,
        reason: d.reason,
      },
      select: { id: true },
    });
  }

  async findForShare(userId: string): Promise<CompanyMemberSnapshot | null> {
    // B-H3: khóa dòng (chặn UPDATE role / grants / lịch nghỉ đến khi transaction này xong) rồi đọc lại.
    const locked = await this.db().$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM company_members WHERE user_id = ${userId}::uuid FOR SHARE`;
    return locked.length > 0 ? this.find(userId) : null;
  }
}

/** Nhiệm kỳ = dòng EMPLOYEE hiện tại (start_date, null) ∪ departures (first_day, last_day) — so theo NGÀY. */
export class PrismaCompanyTenureReader implements ICompanyTenureReader {
  constructor(private readonly db: DbProvider) {}

  async tenuresOf(q: CompanyTenureQuery): Promise<CompanyTenure[]> {
    if (q.userIds?.length === 0) return [];
    const users = q.userIds === undefined ? {} : { userId: { in: [...q.userIds] } };
    const to = new Date(`${q.to}T00:00:00.000Z`);
    const from = new Date(`${q.from}T00:00:00.000Z`);
    // Tuần tự (không Promise.all): trong transaction tương tác client chỉ chạy một truy vấn một lúc.
    const current = await this.db().companyMember.findMany({
      where: { role: 'EMPLOYEE', startDate: { lte: to }, ...users },
      select: { userId: true, startDate: true, offboardLastDay: true },
    });
    const past = await this.db().companyMemberDeparture.findMany({
      where: { role: 'EMPLOYEE', firstDay: { lte: to }, lastDay: { gte: from }, ...users },
      select: { userId: true, firstDay: true, lastDay: true },
    });
    return [
      // A review T-062 MEDIUM-1: có lịch nghỉ ⇒ nhiệm kỳ kết thúc ở `offboard_last_day` (như departure sắp ghi) — khe
      // từ ngày sau lastDay tới lúc hoàn tất không bị tính là ngày làm.
      ...current
        .map((m) => ({
          userId: m.userId,
          from: dateOnly(m.startDate)!,
          until: dateOnly(m.offboardLastDay),
        }))
        .filter((t) => t.until === null || t.until >= q.from),
      ...past.map((d) => ({
        userId: d.userId,
        from: dateOnly(d.firstDay)!,
        until: dateOnly(d.lastDay),
      })),
    ].sort(byUserThenFrom);
  }
}
