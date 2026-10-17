import type {
  ILeaveReadModel,
  LeaveListFilter,
  LeaveListKey,
  LeaveSummary,
} from '../../../application/ports/leave-read-model.port';
import type {
  LeaveBalanceRecord,
  LeaveRequestRecord,
} from '../../../application/ports/leave.ports';
import { halfDaysFromDecimal } from '../../../domain/leave-balance';
import type { CalendarDate } from '../../../domain/leave-days';
import { fromDateOnly, toDateOnly, type DbProvider } from './db';
import { toRecord } from './prisma-leave.repository';

/** Phía đọc leave trên Postgres (CQRS-lite, ADR-015) — phạm vi công ty; không ghi. */
export class PrismaLeaveReadModel implements ILeaveReadModel {
  constructor(private readonly db: DbProvider) {}

  /** Keyset (createdAt, id) giảm dần — mới nhất trước, ổn định khi trùng createdAt. */
  async listRequests(
    filter: LeaveListFilter,
    after: LeaveListKey | null,
    limit: number,
  ): Promise<LeaveRequestRecord[]> {
    const at = after ? new Date(after.createdAt) : null;
    const rows = await this.db().leaveRequest.findMany({
      where: {
        ...(filter.userId === undefined ? {} : { userId: filter.userId }),
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(after && at
          ? { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: after.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toRecord);
  }

  async listApproved(q: {
    userIds?: readonly string[] | undefined;
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<LeaveRequestRecord[]> {
    const rows = await this.db().leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        ...(q.userIds === undefined ? {} : { userId: { in: [...q.userIds] } }),
        startDate: { lte: fromDateOnly(q.to) },
        endDate: { gte: fromDateOnly(q.from) },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async leaveSummaries(refIds: readonly string[]): Promise<ReadonlyMap<string, LeaveSummary>> {
    if (refIds.length === 0) return new Map();
    const rows = await this.db().leaveRequest.findMany({
      where: { id: { in: [...refIds] } },
      select: { id: true, type: true, startDate: true, endDate: true }, // KHÔNG reason (B-H2)
    });
    return new Map(
      rows.map((r) => [
        r.id,
        { type: r.type, startDate: toDateOnly(r.startDate), endDate: toDateOnly(r.endDate) },
      ]),
    );
  }

  async findBalances(
    userIds: readonly string[],
    year: number,
  ): Promise<ReadonlyMap<string, LeaveBalanceRecord>> {
    const rows = await this.db().leaveBalance.findMany({
      where: { year, userId: { in: [...userIds] } },
      select: { userId: true, entitledDays: true, adjustmentDays: true },
    });
    return new Map(
      rows.map((r) => [
        r.userId,
        {
          entitled: halfDaysFromDecimal(r.entitledDays),
          adjustment: halfDaysFromDecimal(r.adjustmentDays),
        },
      ]),
    );
  }

  async listHoldingFor(userIds: readonly string[], year: number): Promise<LeaveRequestRecord[]> {
    const rows = await this.db().leaveRequest.findMany({
      where: {
        userId: { in: [...userIds] },
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

  async findBalance(userId: string, year: number): Promise<LeaveBalanceRecord | null> {
    const row = await this.db().leaveBalance.findUnique({
      where: { userId_year: { userId, year } },
      select: { entitledDays: true, adjustmentDays: true },
    });
    return row
      ? {
          entitled: halfDaysFromDecimal(row.entitledDays),
          adjustment: halfDaysFromDecimal(row.adjustmentDays),
        }
      : null;
  }
}
