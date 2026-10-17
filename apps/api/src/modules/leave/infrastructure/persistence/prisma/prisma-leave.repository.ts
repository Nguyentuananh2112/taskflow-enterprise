import type {
  ILeaveRepository,
  LeaveBalanceRecord,
  LeaveRequestRecord,
} from '../../../application/ports/leave.ports';
import { halfDaysToDecimal } from '../../../domain/leave-balance';
import type { HalfDays } from '../../../domain/leave-days';
import { fromDateOnly, toDateOnly, type DbProvider } from './db';
import { BALANCE_SELECT, balanceFromRow } from './balance-row';

type Row = Awaited<ReturnType<ReturnType<DbProvider>['leaveRequest']['findFirstOrThrow']>>;

export const toRecord = (r: Row): LeaveRequestRecord => ({
  id: r.id,
  userId: r.userId,
  type: r.type,
  startDate: toDateOnly(r.startDate),
  endDate: toDateOnly(r.endDate),
  dayPart: r.dayPart,
  reason: r.reason,
  status: r.status,
  decidedBy: r.decidedById,
  decidedAt: r.decidedAt,
  decisionNote: r.decisionNote,
  version: r.version,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/**
 * Repo đơn nghỉ + số dư trên Postgres — phạm vi công ty (migration 5 `company_level`, company-level ADR-136). Khóa
 * theo user là advisory lock TRANSACTION (bậc 3 bảng khóa) — nhả khi commit/rollback; gọi trong `uow.run` (ADR-012).
 */
export class PrismaLeaveRepository implements ILeaveRepository {
  constructor(private readonly db: DbProvider) {}

  /** `pg_advisory_xact_lock` trả `void` — Prisma không đọc được cột void ⇒ `$executeRaw`. */
  async lockUser(userId: string): Promise<void> {
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`taskflow:leave:${userId}`}, 0))`;
  }

  async listHolding(userId: string, year: number): Promise<LeaveRequestRecord[]> {
    const rows = await this.db().leaveRequest.findMany({
      where: {
        userId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: {
          gte: fromDateOnly(`${String(year)}-01-01`),
          lt: fromDateOnly(`${String(year + 1)}-01-01`),
        },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async listOpen(userId: string): Promise<LeaveRequestRecord[]> {
    const rows = await this.db().leaveRequest.findMany({
      where: { userId, status: { in: ['PENDING', 'APPROVED'] } },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async find(id: string): Promise<LeaveRequestRecord | null> {
    const row = await this.db().leaveRequest.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async add(r: LeaveRequestRecord): Promise<void> {
    await this.db().leaveRequest.create({
      data: {
        id: r.id,
        userId: r.userId,
        type: r.type,
        startDate: fromDateOnly(r.startDate),
        endDate: fromDateOnly(r.endDate),
        dayPart: r.dayPart,
        reason: r.reason,
        status: r.status,
        decidedById: r.decidedBy,
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
        version: r.version,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      },
      select: { id: true },
    });
  }

  /** UPDATE có điều kiện `version` (ADR-010/110) — chỉ cột đổi được sau khi gửi. */
  async save(r: LeaveRequestRecord, expectedVersion: number): Promise<boolean> {
    const { count } = await this.db().leaveRequest.updateMany({
      where: { id: r.id, version: expectedVersion },
      data: {
        status: r.status,
        decidedById: r.decidedBy,
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
        version: r.version,
        updatedAt: r.updatedAt,
      },
    });
    return count === 1;
  }

  /** LB-01: tạo lười, an toàn khi 2 request đọc lần đầu song song (`ON CONFLICT DO NOTHING`). */
  async getOrCreateBalance(userId: string, year: number): Promise<LeaveBalanceRecord> {
    await this.db().$executeRaw`
      INSERT INTO leave_balances (user_id, year)
      VALUES (${userId}::uuid, ${year})
      ON CONFLICT (user_id, year) DO NOTHING`;
    const row = await this.db().leaveBalance.findUniqueOrThrow({
      where: { userId_year: { userId, year } },
      select: BALANCE_SELECT,
    });
    return balanceFromRow(row);
  }

  async setBalanceAdjustment(userId: string, year: number, adjustment: HalfDays): Promise<void> {
    const days = halfDaysToDecimal(adjustment);
    await this.db().$executeRaw`
      INSERT INTO leave_balances (user_id, year, adjustment_days)
      VALUES (${userId}::uuid, ${year}, ${days})
      ON CONFLICT (user_id, year)
      DO UPDATE SET adjustment_days = EXCLUDED.adjustment_days, version = leave_balances.version + 1`;
  }

  /** ADR-131: tạo dòng nếu chưa có, rồi ghi — `ifNull` chỉ khi đang NULL (idempotent cho đường ghi / job). */
  async setCarried(
    userId: string,
    year: number,
    carried: HalfDays,
    mode: 'ifNull' | 'overwrite',
  ): Promise<void> {
    const days = halfDaysToDecimal(carried);
    await this.db().$executeRaw`
      INSERT INTO leave_balances (user_id, year) VALUES (${userId}::uuid, ${year})
      ON CONFLICT (user_id, year) DO NOTHING`;
    await (mode === 'ifNull'
      ? this.db().$executeRaw`
          UPDATE leave_balances SET carried_over_days = ${days}, version = version + 1
           WHERE user_id = ${userId}::uuid AND year = ${year} AND carried_over_days IS NULL`
      : this.db().$executeRaw`
          UPDATE leave_balances SET carried_over_days = ${days}, version = version + 1
           WHERE user_id = ${userId}::uuid AND year = ${year}
             AND carried_over_days IS DISTINCT FROM ${days}`);
  }
}
