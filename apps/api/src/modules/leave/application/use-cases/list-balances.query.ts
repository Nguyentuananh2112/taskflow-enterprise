import type { PageMeta } from '@taskflow/contracts';
import * as z from 'zod';

import { decodeCursor, encodeCursor } from '../../../../core/http/cursor';
import { DEFAULT_ENTITLED_HALF_DAYS } from '../../domain/leave-balance';
import { toBalanceDto, type LeaveBalanceRowDto } from '../leave-dto';
import {
  PERMISSION_HR_MANAGE,
  summarizeStored,
  type LeaveKit,
  type LeaveScope,
} from '../leave-kit';
import type {
  EmployeeKey,
  ILeaveEmployeeDirectory,
  ILeaveReadModel,
} from '../ports/leave-read-model.port';

const BALANCES_CURSOR = 'leave-balances';
const KeySchema = z.object({ fullName: z.string().max(200), id: z.uuid() });

/**
 * `GET leave-balances?year=` (HR, thiết kế §5): MỌI nhân viên hiện tại kể cả chưa có dòng số dư (mặc định 12 ngày,
 * KHÔNG tạo dòng). Một trang = 1 truy vấn nhân viên + 1 số dư + 1 đơn giữ chỗ + 1 lịch năm (không N+1).
 */
export class ListBalancesQuery {
  constructor(
    private readonly kit: LeaveKit,
    private readonly readModel: ILeaveReadModel,
    private readonly employees: ILeaveEmployeeDirectory,
  ) {}

  async execute(
    scope: LeaveScope,
    query: { year: number; cursor?: string | undefined; limit: number },
  ): Promise<{ items: LeaveBalanceRowDto[]; page: PageMeta }> {
    const { workspaceId } = scope;
    await this.kit.requireActor(workspaceId, scope.actorId, PERMISSION_HR_MANAGE);
    const after: EmployeeKey | null = query.cursor
      ? decodeCursor(query.cursor, BALANCES_CURSOR, KeySchema)
      : null;
    const rows = await this.employees.listEmployees(workspaceId, after, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const people = hasMore ? rows.slice(0, query.limit) : rows;
    const ids = people.map((p) => p.id);
    const [stored, holding, calendar] = await Promise.all([
      this.readModel.findBalances(workspaceId, ids, query.year),
      this.readModel.listHoldingFor(workspaceId, ids, query.year),
      ids.length > 0 ? this.kit.yearCalendar(workspaceId, query.year) : Promise.resolve([]),
    ]);
    const items = people.map((user) => ({
      userId: user.id,
      user,
      ...toBalanceDto(
        query.year,
        summarizeStored(
          stored.get(user.id) ?? { entitled: DEFAULT_ENTITLED_HALF_DAYS, adjustment: 0 },
          holding.filter((r) => r.userId === user.id),
          calendar,
        ),
      ),
    }));
    const last = people.at(-1);
    return {
      items,
      page: {
        nextCursor:
          hasMore && last
            ? encodeCursor(BALANCES_CURSOR, { fullName: last.fullName, id: last.id })
            : null,
        hasMore,
        limit: query.limit,
      },
    };
  }
}
