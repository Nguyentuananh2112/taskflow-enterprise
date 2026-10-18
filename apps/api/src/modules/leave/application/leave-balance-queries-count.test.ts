import { describe, expect, it } from 'vitest';

import { LEGAL_LEAVE_POLICY } from '../domain/leave-policy';
import { createLeaveHarness, U } from '../testing/leave-harness';
import { LeaveKit } from './leave-kit';
import { ListBalancesQuery } from './use-cases/list-balances.query';

// T-057d (F 18/10: `GET leave/balances` trang 50 người > 10 s — N+1): số lần gọi PORT dữ liệu (mỗi lần = một truy vấn ở
// bản Prisma) cho MỘT trang KHÔNG phụ thuộc số người, ≤ 12 kể cả khi năm trước bật chuyển phép (đường nặng nhất:
// năm xem chưa chụp ⇒ phép chuyển sang tính tạm cho từng người).

/** Bọc mọi phương thức của `target`, đếm theo tên. */
function counted<T extends object>(target: T, calls: string[], name: string): T {
  return new Proxy(target, {
    get(obj, prop, recv) {
      const v = Reflect.get(obj, prop, recv) as unknown;
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        calls.push(`${name}.${String(prop)}`);
        return (v as (...a: unknown[]) => unknown).apply(obj, args);
      };
    },
  });
}

const person = (n: number) => `00000000-0000-7000-8000-0000000d${n.toString(16).padStart(4, '0')}`;

async function pageCalls(employees: number): Promise<{ calls: string[]; rows: number }> {
  const h = await createLeaveHarness();
  for (let i = 0; i < employees; i++) {
    h.company.set(person(i), 'EMPLOYEE');
    h.users.names.set(person(i), `NV ${String(i).padStart(3, '0')}`);
    h.hireDates.set(person(i), '2015-03-01');
  }
  await h.policies.put({
    year: 2026,
    policy: {
      ...LEGAL_LEAVE_POLICY,
      carryOverEnabled: true,
      carryOverMax: 10,
      carryOverExpiryMonth: 3,
    },
    expectedVersion: 0,
    updatedById: U.Hana,
    at: new Date('2026-01-02T00:00:00Z'),
  });
  const calls: string[] = [];
  const d = h.kit.d;
  const kit = new LeaveKit({
    ...d,
    company: counted(d.company, calls, 'company'),
    hireDates: counted(d.hireDates, calls, 'hireDates'),
    policies: counted(d.policies, calls, 'policies'),
    calendar: counted(d.calendar, calls, 'calendar'),
    requests: counted(d.requests, calls, 'requests'),
  });
  const query = new ListBalancesQuery(
    kit,
    counted(h.readModel, calls, 'readModel'),
    counted(h.employees, calls, 'employees'),
  );
  const page = await query.execute(h.as(U.Hana), { year: 2027, limit: 50 });
  // Cổng quyền (requireActor) không phụ thuộc trang — bỏ khỏi phép đếm dữ liệu.
  return { calls: calls.filter((c) => c !== 'company.reloadActor'), rows: page.items.length };
}

describe('T-057d: số truy vấn một trang số dư cố định', () => {
  it('5 người và 50 người ⇒ cùng một tập lời gọi port; ≤ 12 (năm trước bật chuyển phép, chưa chụp)', async () => {
    const small = await pageCalls(5);
    const large = await pageCalls(50);
    expect(large.rows).toBeGreaterThan(small.rows);
    expect([...large.calls].sort()).toEqual([...small.calls].sort());
    expect(large.calls.length).toBeLessThanOrEqual(12);
    // Không còn lời gọi một-người-một-lần.
    expect(large.calls.filter((c) => c === 'hireDates.hireDateOf')).toEqual([]);
    expect(large.calls.filter((c) => c === 'readModel.findBalance')).toEqual([]);
  });
});
