import type { PageMeta } from '@taskflow/contracts';
import * as z from 'zod';

import { decodeCursor, encodeCursor } from '../../../../core/http/cursor';
import { DEFAULT_ENTITLED_HALF_DAYS } from '../../domain/leave-balance';
import type { LeaveTenure } from '../../domain/leave-tenure';
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

/** Nhiệm kỳ mới nhất giao năm (nhân viên hiện tại: nhiệm kỳ đang mở) — đếm phép theo nhiệm kỳ (D H2). */
const latestTenure = (list: readonly LeaveTenure[] | undefined): LeaveTenure | null =>
  (list ?? []).reduce<LeaveTenure | null>(
    (last, t) => (last === null || t.from > last.from ? t : last),
    null,
  );
const KeySchema = z.object({ fullName: z.string().max(200), id: z.uuid() });

/**
 * `GET leave/balances?year=` (HR): MỌI nhân viên hiện tại (đang làm, chờ kích hoạt, sắp nghỉ — D M3) kể cả chưa có
 * dòng số dư (mặc định 12 ngày, KHÔNG tạo dòng). Một trang = 1 truy vấn nhân viên + 1 số dư + 1 đơn giữ chỗ + 1 lịch
 * năm + 1 nhiệm kỳ (không N+1); số dư đếm theo nhiệm kỳ mới nhất giao năm.
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
    await this.kit.requireActor(scope.actorId, PERMISSION_HR_MANAGE);
    const after: EmployeeKey | null = query.cursor
      ? decodeCursor(query.cursor, BALANCES_CURSOR, KeySchema)
      : null;
    const rows = await this.employees.listEmployees(after, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const people = hasMore ? rows.slice(0, query.limit) : rows;
    const ids = people.map((p) => p.id);
    const from = `${String(query.year)}-01-01`;
    const to = `${String(query.year)}-12-31`;
    const [stored, holding, calendar, tenures] = await Promise.all([
      this.readModel.findBalances(ids, query.year),
      this.readModel.listHoldingFor(ids, query.year),
      ids.length > 0 ? this.kit.yearCalendar(query.year) : Promise.resolve([]),
      this.kit.d.company.tenuresOf({ userIds: ids, from, to }),
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
          { tenure: latestTenure(tenures.get(user.id)) },
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
