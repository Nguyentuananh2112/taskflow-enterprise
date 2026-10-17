import { describe, expect, it } from 'vitest';

import { createAttendanceHarness, key, MAX, MIA, OLIVIA, VIC } from '../testing/attendance-harness';
import { payrollDaysFor, payrollMembersOf } from './payroll-days';

// payroll.md ADR-126/127 (T-049) tầng A: công tính lương của kỳ qua dữ liệu thật của attendance (lượt chấm, phép typed,
// nhiệm kỳ, retention) — hàm thuần payrollDaysOf ở domain có bảng PD đầy đủ.

async function november() {
  const t = await createAttendanceHarness('2026-11-16 07:55');
  // 16/11 (T2): đi đủ IN + OUT ⇒ PRESENT.
  t.at('2026-11-16 08:00');
  await t.punch('IN', key(1));
  t.at('2026-11-16 17:30');
  await t.punch('OUT', key(2));
  // 17/11: AM ANNUAL + PM UNPAID (2 dòng khác loại) ⇒ 1 nửa.
  t.leaves.rows.push(
    { userId: MIA, date: '2026-11-17', part: 'AM', type: 'ANNUAL' },
    { userId: MIA, date: '2026-11-17', part: 'PM', type: 'UNPAID' },
  );
  // 18/11: phép cả ngày SICK nhưng vẫn chấm IN + OUT ⇒ 0 (phép thắng lượt chấm).
  t.leaves.rows.push({ userId: MIA, date: '2026-11-18', part: 'FULL', type: 'SICK' });
  t.at('2026-11-18 08:00');
  await t.punch('IN', key(3));
  t.at('2026-11-18 17:30');
  await t.punch('OUT', key(4));
  // 19/11: IN không OUT ⇒ MISSING_OUT ⇒ 0, được liệt kê.
  t.at('2026-11-19 08:00');
  await t.punch('IN', key(5));
  t.at('2026-12-01 09:00');
  return t;
}

describe('payrollDaysFor', () => {
  it('kỳ 11/2026: S = 25; Mia = 2 (16) + 1 (17) + 0 (18 SICK có chấm) + 0 (19 MISSING_OUT) = 3 nửa', async () => {
    const t = await november();
    const r = await payrollDaysFor(t.deps, { userIds: [MIA, MAX], period: '2026-11' });
    expect(r.standardDays).toBe(25);
    expect(r.byUser.get(MIA)).toEqual({
      ok: true,
      halfDays: 3,
      missingOutDates: ['2026-11-19'],
      sickDays: 1,
    });
    expect(r.byUser.get(MAX)).toEqual({ ok: true, halfDays: 0, missingOutDates: [], sickDays: 0 });
  });

  it('đọc phép ĐÚNG một lần cho cả ô ngày lẫn các nửa (ADR-126 — một nguồn phép)', async () => {
    const t = await november();
    let reads = 0;
    const read = t.leaves.approvedLeaves.bind(t.leaves);
    t.leaves.approvedLeaves = (q) => {
      reads++;
      return read(q);
    };
    await payrollDaysFor(t.deps, { userIds: [MIA], period: '2026-11' });
    expect(reads).toBe(1);
  });

  it('nhiệm kỳ: nghỉ việc ngày 16 ⇒ chỉ đếm tới 16; vào ngày 17 ⇒ đếm từ 17', async () => {
    const t = await november();
    t.tenures.rows.splice(
      t.tenures.rows.findIndex((r) => r.userId === MIA),
      1,
      {
        userId: MIA,
        from: '2020-01-01',
        until: '2026-11-16',
      },
    );
    expect(
      (await payrollDaysFor(t.deps, { userIds: [MIA], period: '2026-11' })).byUser.get(MIA),
    ).toEqual({
      ok: true,
      halfDays: 2,
      missingOutDates: [],
      sickDays: 0,
    });
    t.tenures.rows.splice(
      t.tenures.rows.findIndex((r) => r.userId === MIA),
      1,
      {
        userId: MIA,
        from: '2026-11-17',
        until: null,
      },
    );
    expect(
      (await payrollDaysFor(t.deps, { userIds: [MIA], period: '2026-11' })).byUser.get(MIA),
    ).toEqual({
      ok: true,
      halfDays: 1,
      missingOutDates: ['2026-11-19'],
      sickDays: 1,
    });
  });

  it('kỳ có ngày quá hạn retention ⇒ ATTENDANCE_RETENTION_EXPIRED cho từng người', async () => {
    const t = await november();
    t.retention.cutoff = '2026-11-05';
    const r = await payrollDaysFor(t.deps, { userIds: [MIA], period: '2026-11' });
    expect(r.byUser.get(MIA)).toEqual({ ok: false, reason: 'ATTENDANCE_RETENTION_EXPIRED' });
  });
});

describe('payrollMembersOf — người trong kỳ (ADR-127)', () => {
  it('nhân viên có nhiệm kỳ giao tháng; Admin chưa từng là nhân viên không có; nghỉ trước kỳ không có; nghỉ trong kỳ có', async () => {
    const t = await createAttendanceHarness();
    t.tenures.rows.splice(
      t.tenures.rows.findIndex((r) => r.userId === VIC),
      1,
      {
        userId: VIC,
        from: '2020-01-01',
        until: '2026-10-31',
      },
    );
    t.tenures.rows.splice(
      t.tenures.rows.findIndex((r) => r.userId === MAX),
      1,
      {
        userId: MAX,
        from: '2020-01-01',
        until: '2026-11-01',
      },
    );
    const members = await payrollMembersOf(t.deps, '2026-11');
    expect(members).toContain(MIA);
    expect(members).toContain(MAX);
    expect(members).not.toContain(VIC);
    expect(members).not.toContain(OLIVIA);
    expect([...members]).toEqual([...members].sort());
  });
});
