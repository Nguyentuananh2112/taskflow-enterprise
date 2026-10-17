import type { Prisma } from '../../../../generated/prisma/client';
import type {
  CompanyTenure,
  CompanyTenureQuery,
  ICompanyMemberRepository,
  ICompanyTenureReader,
} from '../../application/ports/company-member.port';
import type { CompanyMemberSnapshot } from '../../domain/company-member';

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

export class PrismaCompanyMembers implements ICompanyMemberRepository {
  constructor(private readonly db: DbProvider) {}

  async find(userId: string): Promise<CompanyMemberSnapshot | null> {
    const r = await this.db().companyMember.findUnique({ where: { userId } });
    return r
      ? {
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
        }
      : null;
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
      select: { userId: true, startDate: true },
    });
    const past = await this.db().companyMemberDeparture.findMany({
      where: { role: 'EMPLOYEE', firstDay: { lte: to }, lastDay: { gte: from }, ...users },
      select: { userId: true, firstDay: true, lastDay: true },
    });
    return [
      ...current.map((m) => ({ userId: m.userId, from: dateOnly(m.startDate)!, until: null })),
      ...past.map((d) => ({
        userId: d.userId,
        from: dateOnly(d.firstDay)!,
        until: dateOnly(d.lastDay),
      })),
    ].sort(byUserThenFrom);
  }
}
