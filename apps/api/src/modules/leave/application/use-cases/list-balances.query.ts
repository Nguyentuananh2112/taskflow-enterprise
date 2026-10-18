import type { PageMeta } from '@taskflow/contracts';
import * as z from 'zod';

import { decodeCursor, encodeCursor } from '../../../../core/http/cursor';
import { toBalanceDto, type LeaveBalanceRowDto } from '../leave-dto';
import { PERMISSION_HR_MANAGE, type LeaveKit, type LeaveScope } from '../leave-kit';
import { latestTenure } from '../balance-prefetch';
import type {
  EmployeeKey,
  ILeaveEmployeeDirectory,
  ILeaveReadModel,
} from '../ports/leave-read-model.port';

const BALANCES_CURSOR = 'leave-balances';

const KeySchema = z.object({ fullName: z.string().max(200), id: z.uuid() });

/**
 * `GET leave/balances?year=` (HR): MỌI nhân viên hiện tại (đang làm, chờ kích hoạt, sắp nghỉ — D M3) kể cả chưa có
 * dòng số dư (mặc định 12 ngày, KHÔNG tạo dòng). Một trang = số truy vấn CỐ ĐỊNH (nhân viên, số dư, đơn giữ chỗ,
 * nhiệm kỳ, lịch, chính sách, ngày vào + phần năm trước khi bật chuyển phép — T-057d), không theo số người; số dư
 * đếm theo nhiệm kỳ mới nhất giao năm.
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
    const [stored, holding, tenures, today] = await Promise.all([
      this.readModel.findBalances(ids, query.year),
      this.readModel.listHoldingFor(ids, query.year),
      this.kit.d.company.tenuresOf({ userIds: ids, from, to }),
      this.kit.today(),
    ]);
    // Một bộ tính cho cả trang: chính sách + lịch năm cache một lần (phép chuyển sang tạm tính chỉ truy vấn thêm
    // cho người có nhiệm kỳ liên tục qua giao thừa khi năm trước bật chuyển phép).
    // T-057d: ngày vào, nhiệm kỳ qua giao thừa, số dư + đơn năm trước nạp THEO LÔ ⇒ số truy vấn cố định mỗi trang.
    const calc = await this.kit.readCalculatorFor(this.readModel, {
      userIds: ids,
      year: query.year,
      currentYearLoaded: true,
    });
    const items: LeaveBalanceRowDto[] = [];
    for (const user of people) {
      const view = await calc.compute({
        userId: user.id,
        year: query.year,
        today,
        tenure: latestTenure(tenures.get(user.id)),
        holding: holding.filter((r) => r.userId === user.id),
        stored: stored.get(user.id) ?? null,
      });
      items.push({ userId: user.id, user, ...toBalanceDto(view) });
    }
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
