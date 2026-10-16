import type {
  ILeaveRepository,
  LeaveBalanceRecord,
  LeaveRequestRecord,
} from '../../../application/ports/leave.ports';
import { halfDaysFromDecimal, halfDaysToDecimal } from '../../../domain/leave-balance';
import type { HalfDays } from '../../../domain/leave-days';
import { fromDateOnly, toDateOnly, type DbProvider } from './db';

type Row = Awaited<ReturnType<ReturnType<DbProvider>['leaveRequest']['findFirstOrThrow']>>;

const toRecord = (r: Row): LeaveRequestRecord => ({
  id: r.id,
  workspaceId: r.workspaceId,
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
 * Repo đơn nghỉ + số dư trên Postgres (migration 3 — T-037). Mọi truy vấn có `workspaceId` (tenant). Khóa
 * (ws, user) là advisory lock TRANSACTION — nhả khi commit/rollback; gọi trong `uow.run` (ADR-012).
 */
export class PrismaLeaveRepository implements ILeaveRepository {
  constructor(private readonly db: DbProvider) {}

  /** `pg_advisory_xact_lock` trả `void` — Prisma không đọc được cột void ⇒ `$executeRaw`. */
  async lockUser(workspaceId: string, userId: string): Promise<void> {
    await this.db().$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`taskflow:leave:${workspaceId}:${userId}`}, 0))`;
  }

  async listHolding(
    workspaceId: string,
    userId: string,
    year: number,
  ): Promise<LeaveRequestRecord[]> {
    const rows = await this.db().leaveRequest.findMany({
      where: {
        workspaceId,
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

  async find(workspaceId: string, id: string): Promise<LeaveRequestRecord | null> {
    const row = await this.db().leaveRequest.findFirst({ where: { id, workspaceId } });
    return row ? toRecord(row) : null;
  }

  async add(r: LeaveRequestRecord): Promise<void> {
    await this.db().leaveRequest.create({
      data: {
        id: r.id,
        workspaceId: r.workspaceId,
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

  /** UPDATE có điều kiện tenant + `version` (ADR-010/110) — chỉ cột đổi được sau khi gửi. */
  async save(r: LeaveRequestRecord, expectedVersion: number): Promise<boolean> {
    const { count } = await this.db().leaveRequest.updateMany({
      where: { id: r.id, workspaceId: r.workspaceId, version: expectedVersion },
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
  async getOrCreateBalance(
    workspaceId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalanceRecord> {
    await this.db().$executeRaw`
      INSERT INTO leave_balances (workspace_id, user_id, year)
      VALUES (${workspaceId}::uuid, ${userId}::uuid, ${year})
      ON CONFLICT (workspace_id, user_id, year) DO NOTHING`;
    const row = await this.db().leaveBalance.findUniqueOrThrow({
      where: { workspaceId_userId_year: { workspaceId, userId, year } },
      select: { entitledDays: true, adjustmentDays: true },
    });
    return {
      entitled: halfDaysFromDecimal(row.entitledDays),
      adjustment: halfDaysFromDecimal(row.adjustmentDays),
    };
  }

  async setBalanceAdjustment(
    workspaceId: string,
    userId: string,
    year: number,
    adjustment: HalfDays,
  ): Promise<void> {
    const days = halfDaysToDecimal(adjustment);
    await this.db().$executeRaw`
      INSERT INTO leave_balances (workspace_id, user_id, year, adjustment_days)
      VALUES (${workspaceId}::uuid, ${userId}::uuid, ${year}, ${days})
      ON CONFLICT (workspace_id, user_id, year)
      DO UPDATE SET adjustment_days = EXCLUDED.adjustment_days, version = leave_balances.version + 1`;
  }

  async hasHistory(workspaceId: string, userId: string): Promise<boolean> {
    const [request, balance] = await Promise.all([
      this.db().leaveRequest.findFirst({ where: { workspaceId, userId }, select: { id: true } }),
      this.db().leaveBalance.findFirst({ where: { workspaceId, userId }, select: { year: true } }),
    ]);
    return request !== null || balance !== null;
  }
}
