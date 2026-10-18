import { resolvePolicy } from '../domain/leave-policy';
import type { CalendarDate } from '../domain/leave-days';
import type { LeaveTenure } from '../domain/leave-tenure';
import type { BalanceSources } from './annual-balance';
import type { ILeaveReadModel } from './ports/leave-read-model.port';
import type { LeaveBalanceRecord, LeaveRequestRecord } from './ports/leave.ports';

// T-057d (F 18/10 — `GET leave/balances` trang 50 người > 10 s): nạp THEO LÔ mọi thứ AnnualBalanceCalculator cần cho
// một nhóm người + một năm, trả `BalanceSources` đọc từ cache — số truy vấn mỗi trang cố định, không theo số người.
// Người / năm ngoài nhóm đã nạp ⇒ rơi về nguồn gốc (một truy vấn như trước). Chỉ dùng cho ĐƯỜNG ĐỌC.

const key = (userId: string, year: number) => `${userId}|${String(year)}`;

export async function prefetchedSources(
  base: BalanceSources,
  read: Pick<ILeaveReadModel, 'findBalances' | 'listHoldingFor'>,
  input: {
    userIds: readonly string[];
    year: number;
    /** Số dư + đơn năm `year` đã có sẵn ở bên gọi (trang danh sách) ⇒ không nạp lại. */
    currentYearLoaded: boolean;
  },
): Promise<BalanceSources> {
  const { userIds, year } = input;
  const prev = year - 1;
  const policies = base.policies.list();
  const carry = resolvePolicy(await policies, prev).policy.carryOverEnabled;
  const years = [...(input.currentYearLoaded ? [] : [year]), ...(carry ? [prev] : [])];
  const [hires, boundary, ...perYear] = await Promise.all([
    base.hireDates.hireDatesOf?.(userIds) ?? Promise.resolve(null),
    carry
      ? base.company.tenuresOf({
          userIds,
          from: `${String(prev)}-12-31`,
          to: `${String(year)}-01-01`,
        })
      : Promise.resolve(null),
    ...years.flatMap((y) => [read.findBalances(userIds, y), read.listHoldingFor(userIds, y)]),
  ]);

  const stored = new Map<string, LeaveBalanceRecord | null>();
  const holding = new Map<string, LeaveRequestRecord[]>();
  years.forEach((y, i) => {
    const balances = perYear[2 * i] as ReadonlyMap<string, LeaveBalanceRecord>;
    const requests = perYear[2 * i + 1] as LeaveRequestRecord[];
    for (const id of userIds) {
      stored.set(key(id, y), balances.get(id) ?? null);
      holding.set(
        key(id, y),
        requests.filter((r) => r.userId === id),
      );
    }
  });
  const inGroup = new Set(userIds);
  const boundaryFrom = `${String(prev)}-12-31`;

  return {
    ...base,
    policies: { list: () => policies },
    hireDates: {
      hireDateOf: (userId) =>
        hires?.has(userId) === true
          ? Promise.resolve(hires.get(userId) ?? null)
          : hires !== null && inGroup.has(userId)
            ? Promise.resolve<CalendarDate | null>(null)
            : base.hireDates.hireDateOf(userId),
    },
    company: {
      tenuresOf: (q) => {
        // Đúng truy vấn giao thừa của carriedInto cho MỘT người trong nhóm ⇒ trả từ lô.
        const one = q.userIds.length === 1 ? q.userIds[0]! : null;
        if (
          boundary &&
          one &&
          inGroup.has(one) &&
          q.from === boundaryFrom &&
          q.to === `${String(year)}-01-01`
        ) {
          return Promise.resolve(
            new Map<string, readonly LeaveTenure[]>([[one, boundary.get(one) ?? []]]),
          );
        }
        return base.company.tenuresOf(q);
      },
    },
    storedOf: (userId, y) => {
      const k = key(userId, y);
      return stored.has(k) ? Promise.resolve(stored.get(k) ?? null) : base.storedOf(userId, y);
    },
    holdingOf: (userId, y) => {
      const k = key(userId, y);
      return holding.has(k) ? Promise.resolve(holding.get(k)!) : base.holdingOf(userId, y);
    },
  };
}

/**
 * Nhiệm kỳ mới nhất giao năm (nhân viên hiện tại: nhiệm kỳ đang mở) — đếm phép theo nhiệm kỳ (D H2). Trang số dư và
 * báo cáo phép dùng CHUNG (T-057d: cùng con số trên màn hình và trong file).
 */
export const latestTenure = (list: readonly LeaveTenure[] | undefined): LeaveTenure | null =>
  (list ?? []).reduce<LeaveTenure | null>(
    (last, t) => (last === null || t.from > last.from ? t : last),
    null,
  );
