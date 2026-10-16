import type {
  ILeaveReadModel,
  LeaveListFilter,
  LeaveListKey,
} from '../../../application/ports/leave-read-model.port';
import type {
  LeaveBalanceRecord,
  LeaveRequestRecord,
} from '../../../application/ports/leave.ports';
import { halfDaysFromDecimal } from '../../../domain/leave-balance';
import type { CalendarDate } from '../../../domain/leave-days';
import { fromDateOnly, type DbProvider } from './db';
import { toRecord } from './prisma-leave.repository';

/** Phía đọc leave trên Postgres (CQRS-lite, ADR-015). Mọi truy vấn có `workspaceId` (tenant); không ghi. */
export class PrismaLeaveReadModel implements ILeaveReadModel {
  constructor(private readonly db: DbProvider) {}

  /** Keyset (createdAt, id) giảm dần — mới nhất trước, ổn định khi trùng createdAt. */
  async listRequests(
    workspaceId: string,
    filter: LeaveListFilter,
    after: LeaveListKey | null,
    limit: number,
  ): Promise<LeaveRequestRecord[]> {
    const at = after ? new Date(after.createdAt) : null;
    const rows = await this.db().leaveRequest.findMany({
      where: {
        workspaceId,
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
    workspaceId: string;
    userIds?: readonly string[] | undefined;
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<LeaveRequestRecord[]> {
    const rows = await this.db().leaveRequest.findMany({
      where: {
        workspaceId: q.workspaceId,
        status: 'APPROVED',
        ...(q.userIds === undefined ? {} : { userId: { in: [...q.userIds] } }),
        startDate: { lte: fromDateOnly(q.to) },
        endDate: { gte: fromDateOnly(q.from) },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findBalances(
    workspaceId: string,
    userIds: readonly string[],
    year: number,
  ): Promise<ReadonlyMap<string, LeaveBalanceRecord>> {
    const rows = await this.db().leaveBalance.findMany({
      where: { workspaceId, year, userId: { in: [...userIds] } },
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

  async listHoldingFor(
    workspaceId: string,
    userIds: readonly string[],
    year: number,
  ): Promise<LeaveRequestRecord[]> {
    const rows = await this.db().leaveRequest.findMany({
      where: {
        workspaceId,
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

  async findBalance(
    workspaceId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalanceRecord | null> {
    const row = await this.db().leaveBalance.findUnique({
      where: { workspaceId_userId_year: { workspaceId, userId, year } },
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
