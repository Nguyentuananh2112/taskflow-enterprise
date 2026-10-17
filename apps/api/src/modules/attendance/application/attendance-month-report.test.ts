import { describe, expect, it } from 'vitest';

import { createAttendanceHarness, key, MAX, MIA, VIC } from '../testing/attendance-harness';
import {
  attendanceMonthSheets,
  type ReportCell,
  type ReportSheet,
} from './attendance-month-report';
import { HrAttendanceQueries } from './use-cases/hr-attendance.queries';

// T-056 (hr-extended ADR-130) tầng A: nội dung bảng công tháng .xlsx — XL-01 (tên sheet), XL-02 (tổng = API), XL-04
// (người đã nghỉ có nhãn), nhịp đọc theo lô (ExportLimits), không lộ lý do / IP.

const collect = async (sheet: ReportSheet) => {
  const rows: (readonly ReportCell[])[] = [];
  for await (const row of sheet.rows) rows.push(row);
  return rows;
};

async function november() {
  const t = await createAttendanceHarness('2026-11-16 08:00');
  await t.punch('IN', key(1));
  t.at('2026-11-16 17:30');
  await t.punch('OUT', key(2));
  t.at('2026-11-17 08:30'); // muộn 30 phút, không ra ⇒ MISSING_OUT
  await t.punch('IN', key(3));
  t.leaves.rows.push({ userId: MIA, date: '2026-11-18', part: 'FULL', type: 'ANNUAL' });
  t.at('2026-12-01 09:00');
  // Vic nghỉ việc 15/11 ⇒ vẫn có dòng tháng 11, nhãn "Đã nghỉ".
  t.tenures.rows.splice(
    t.tenures.rows.findIndex((r) => r.userId === VIC),
    1,
    {
      userId: VIC,
      from: '2020-01-01',
      until: '2026-11-15',
    },
  );
  return t;
}

const sleepSpy = () => {
  const calls: number[] = [];
  return { calls, sleep: (ms: number) => (calls.push(ms), Promise.resolve()) };
};

describe('attendanceMonthSheets', () => {
  it('XL-01 ba sheet đúng tên + cột; XL-02 "Tổng hợp" khớp tổng của bảng HR (cùng totalsOf); XL-04 nhãn đã nghỉ', async () => {
    const t = await november();
    const hr = new HrAttendanceQueries({ ...t.deps, users: t.collaborators.users });
    const roster = await hr.roster('2026-11-01', '2026-11-30');
    const sheets = attendanceMonthSheets(
      t.deps,
      { roster, from: '2026-11-01', to: '2026-11-30', today: '2026-12-01' },
      { batchSize: 2, batchDelayMs: 0, sleep: () => Promise.resolve() },
    );
    expect(sheets.map((s) => s.name)).toEqual(['Tổng hợp', 'Theo ngày', 'Giờ vào – ra']);
    const summary = await collect(sheets[0]!);
    const api = await hr.month({ month: '2026-11', limit: 50 });
    for (const row of api.data) {
      const mine = summary.find((r) => r[0] === row.user.fullName)!;
      expect(mine.slice(2)).toEqual([
        row.totals.presentDays,
        row.totals.missingOutDays,
        row.totals.absentDays,
        row.totals.leaveDays,
        row.totals.lateDays,
        row.totals.lateMin,
        row.totals.earlyDays,
        row.totals.earlyMin,
        row.totals.workedMin,
      ]);
    }
    const mia = summary.find((r) => r[0] === 'Mia')!;
    expect(mia.slice(1, 5)).toEqual(['Đang làm', 2, 1, mia[4]]);
    expect(summary.find((r) => r[0] === 'Vic')?.[1]).toBe('Đã nghỉ');

    const matrix = await collect(sheets[1]!);
    expect(sheets[1]!.columns).toHaveLength(2 + 30);
    const miaDays = matrix.find((r) => r[0] === 'Mia')!;
    expect(miaDays.slice(2 + 15, 2 + 18)).toEqual(['X', 'Thiếu ra', 'P']); // 16, 17, 18/11

    const detail = await collect(sheets[2]!);
    expect(detail.filter((r) => r[0] === 'Mia')).toHaveLength(30);
    expect(detail.find((r) => r[0] === 'Mia' && r[2] === '2026-11-16')).toEqual([
      'Mia',
      null,
      '2026-11-16',
      'T2',
      'Có mặt',
      '08:00',
      '17:30',
      expect.any(Number),
      0,
      0,
      null,
      null,
    ]);
    expect(JSON.stringify([summary, matrix, detail])).not.toMatch(/203\.0\.113|Mozilla/);
  });

  it('nhịp đọc: lô batchSize người, trễ batchDelayMs CHỈ giữa hai lô (không trước lô đầu)', async () => {
    const t = await november();
    const hr = new HrAttendanceQueries({ ...t.deps, users: t.collaborators.users });
    const roster = await hr.roster('2026-11-01', '2026-11-30');
    expect(roster.length).toBeGreaterThanOrEqual(4); // Hana, Mia, Max, Vic
    const spy = sleepSpy();
    const [summary] = attendanceMonthSheets(
      t.deps,
      { roster, from: '2026-11-01', to: '2026-11-30', today: '2026-12-01' },
      { batchSize: 2, batchDelayMs: 25, sleep: spy.sleep },
    );
    expect(await collect(summary!)).toHaveLength(roster.length);
    expect(spy.calls).toEqual(Array(Math.ceil(roster.length / 2) - 1).fill(25));
    expect(roster.map((r) => r.user.id)).toEqual(expect.arrayContaining([MIA, MAX]));
  });
});
