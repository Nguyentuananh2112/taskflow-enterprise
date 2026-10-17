import { describe, expect, it } from 'vitest';

import {
  payrollDaysOf,
  standardDaysOf,
  type PayrollLeaveHalf,
  type PayrollLeaveType,
} from './payroll-days';
import type { DayStatus } from './summarize-day';
import type { WorkSchedule } from './work-schedule';

// payroll.md §7 — PD (công nửa ngày) + SD (công chuẩn), T-049. Lịch mặc định T2–T7. 16/11/2026 là thứ Hai, 22/11 Chủ nhật.
const MON = '2026-11-16';
const SUN = '2026-11-22';
const always = [{ from: '2020-01-01', until: null }];
const half = (date: string, part: 'AM' | 'PM', type: PayrollLeaveType): PayrollLeaveHalf => ({
  date,
  part,
  type,
});
const full = (date: string, type: PayrollLeaveType) => [
  half(date, 'AM', type),
  half(date, 'PM', type),
];

/** Công của MỘT ngày `date` với trạng thái ô ngày + phép. */
const day = (
  status: DayStatus,
  leaves: PayrollLeaveHalf[] = [],
  over: { date?: string; tenures?: { from: string; until: string | null }[] } = {},
) => {
  const date = over.date ?? MON;
  const r = payrollDaysOf({
    from: date,
    to: date,
    statusOf: new Map([[date, status]]),
    leaves,
    schedules: [],
    tenures: over.tenures ?? always,
    retentionCutoff: null,
  });
  return r.ok ? r.halfDays : r.reason;
};

describe('payrollDaysOf — PD', () => {
  it('PRESENT không phép = 2 (đi muộn / về sớm / ít giờ vẫn 2 — trạng thái là PRESENT)', () => {
    expect(day('PRESENT')).toBe(2);
  });

  it('PRESENT + AM ANNUAL = 2; PRESENT + AM UNPAID = 1; ABSENT + AM ANNUAL = 1', () => {
    expect(day('PRESENT', [half(MON, 'AM', 'ANNUAL')])).toBe(2);
    expect(day('PRESENT', [half(MON, 'AM', 'UNPAID')])).toBe(1);
    expect(day('ABSENT', [half(MON, 'AM', 'ANNUAL')])).toBe(1);
  });

  it('MISSING_OUT + AM ANNUAL = 1; MISSING_OUT không phép = 0 (và được liệt kê để cảnh báo khi phát hành)', () => {
    expect(day('MISSING_OUT', [half(MON, 'AM', 'ANNUAL')])).toBe(1);
    expect(day('MISSING_OUT')).toBe(0);
    const r = payrollDaysOf({
      from: MON,
      to: '2026-11-17',
      statusOf: new Map<string, DayStatus>([
        [MON, 'MISSING_OUT'],
        ['2026-11-17', 'PRESENT'],
      ]),
      leaves: [],
      schedules: [],
      tenures: always,
      retentionCutoff: null,
    });
    expect(r).toEqual({ ok: true, halfDays: 2, missingOutDates: [MON] });
  });

  it('2 dòng/ngày khác loại: AM ANNUAL + PM UNPAID = 1; PERSONAL_PAID có lương', () => {
    expect(day('ON_LEAVE', [half(MON, 'AM', 'ANNUAL'), half(MON, 'PM', 'UNPAID')])).toBe(1);
    expect(day('ON_LEAVE', full(MON, 'PERSONAL_PAID'))).toBe(2);
  });

  it('phép cả ngày SICK / UNPAID / OTHER = 0; phép cả ngày UNPAID + có IN+OUT (PRESENT) = 0 — phép thắng lượt chấm', () => {
    for (const type of ['SICK', 'UNPAID', 'OTHER'] as const)
      expect(day('ON_LEAVE', full(MON, type))).toBe(0);
    expect(day('PRESENT', full(MON, 'UNPAID'))).toBe(0);
  });

  it('dòng phép trùng cùng nửa không cộng hai lần; có một dòng có lương ⇒ 1; tổng ≤ 2 nửa/ngày', () => {
    expect(day('PRESENT', [...full(MON, 'ANNUAL'), ...full(MON, 'ANNUAL')])).toBe(2);
    expect(day('ABSENT', [half(MON, 'AM', 'UNPAID'), half(MON, 'AM', 'ANNUAL')])).toBe(1);
    expect(day('ABSENT', [half(MON, 'AM', 'ANNUAL'), half(MON, 'AM', 'UNPAID')])).toBe(1);
  });

  it('HOLIDAY ngày làm việc = 2; lễ rơi Chủ nhật (OFF) = 0; Chủ nhật có chấm = 0', () => {
    expect(day('HOLIDAY')).toBe(2);
    expect(day('HOLIDAY', [], { date: SUN })).toBe(0);
    expect(day('PRESENT', [], { date: SUN })).toBe(0);
  });

  it('ABSENT / OFF / NOT_EMPLOYED không phép = 0', () => {
    for (const s of ['ABSENT', 'OFF', 'NOT_EMPLOYED', 'PENDING'] as const) expect(day(s)).toBe(0);
  });

  it('nhiệm kỳ bằng ngày: start_date tính, ngày trước = 0; last_day tính, ngày sau = 0 — kể cả có lượt chấm', () => {
    const t = [{ from: '2026-11-17', until: '2026-11-18' }];
    expect(day('PRESENT', [], { date: MON, tenures: t })).toBe(0);
    expect(day('PRESENT', [], { date: '2026-11-17', tenures: t })).toBe(2);
    expect(day('PRESENT', [], { date: '2026-11-18', tenures: t })).toBe(2);
    expect(day('PRESENT', [], { date: '2026-11-19', tenures: t })).toBe(0);
    expect(day('HOLIDAY', [], { date: '2026-11-19', tenures: t })).toBe(0);
    expect(day('ON_LEAVE', full('2026-11-19', 'ANNUAL'), { date: '2026-11-19', tenures: t })).toBe(
      0,
    );
  });

  it('ngày thiếu ô (không có trong statusOf) không phép ⇒ 0; có phép có lương ⇒ theo phép', () => {
    const r = (leaves: PayrollLeaveHalf[]) =>
      payrollDaysOf({
        from: MON,
        to: MON,
        statusOf: new Map(),
        leaves,
        schedules: [],
        tenures: always,
        retentionCutoff: null,
      });
    expect(r([])).toEqual({ ok: true, halfDays: 0, missingOutDates: [] });
    expect(r(full(MON, 'ANNUAL'))).toEqual({ ok: true, halfDays: 2, missingOutDates: [] });
  });

  it('kỳ có ngày trước mốc retention ⇒ ATTENDANCE_RETENTION_EXPIRED; đúng mốc ⇒ tính', () => {
    const at = (cutoff: string) =>
      payrollDaysOf({
        from: '2026-11-01',
        to: '2026-11-30',
        statusOf: new Map(),
        leaves: [],
        schedules: [],
        tenures: always,
        retentionCutoff: cutoff,
      });
    expect(at('2026-11-02')).toEqual({ ok: false, reason: 'ATTENDANCE_RETENTION_EXPIRED' });
    expect(at('2026-11-01')).toMatchObject({ ok: true });
  });

  it('cả tháng 11/2026 đi đủ (PRESENT mọi ngày làm) ⇒ 2 × công chuẩn', () => {
    const statusOf = new Map<string, DayStatus>();
    for (let d = 1; d <= 30; d++) statusOf.set(`2026-11-${String(d).padStart(2, '0')}`, 'PRESENT');
    const r = payrollDaysOf({
      from: '2026-11-01',
      to: '2026-11-30',
      statusOf,
      leaves: [],
      schedules: [],
      tenures: always,
      retentionCutoff: null,
    });
    expect(r).toEqual({ ok: true, halfDays: 2 * 25, missingOutDates: [] });
  });
});

describe('payrollDaysOf — PD-13 / PD-17 / PD-19 (F, test-spec-payroll)', () => {
  const novemberAll = (status: DayStatus) => {
    const m = new Map<string, DayStatus>();
    for (let d = 1; d <= 30; d++) m.set(`2026-11-${String(d).padStart(2, '0')}`, status);
    return m;
  };
  const run = (over: Partial<Parameters<typeof payrollDaysOf>[0]>) =>
    payrollDaysOf({
      from: '2026-11-01',
      to: '2026-11-30',
      statusOf: novemberAll('PRESENT'),
      leaves: [],
      schedules: [],
      tenures: always,
      retentionCutoff: null,
      ...over,
    });

  it('PD-13 hai nhiệm kỳ trong tháng (nghỉ 10/11, nhận lại 20/11): chỉ đếm 1..10 và 20..30', () => {
    // T2–T7: 1..10 có 8 ngày làm (2–7, 9, 10); 20..30 có 9 (20, 21, 23–28, 30).
    const tenures = [
      { from: '2020-01-01', until: '2026-11-10' },
      { from: '2026-11-20', until: null },
    ];
    expect(run({ tenures })).toEqual({ ok: true, halfDays: 2 * (8 + 9), missingOutDates: [] });
  });

  it('PD-17 đổi lịch giữa tháng (T2–T6 từ 16/11): thứ Bảy sau 16/11 không còn là ngày làm ⇒ 0 dù PRESENT', () => {
    const monFri: WorkSchedule = {
      effectiveFrom: '2026-11-16',
      timezone: 'Asia/Ho_Chi_Minh',
      workdays: 0b0011111,
      startMin: 480,
      endMin: 1020,
      breakStartMin: 720,
      breakEndMin: 780,
      graceMin: 0,
    };
    expect(run({ schedules: [monFri] })).toEqual({
      ok: true,
      halfDays: 2 * (12 + 11),
      missingOutDates: [],
    });
  });

  it('PD-19 property (seed cố định): 0 ≤ h ≤ 2 × số ngày làm trong nhiệm kỳ; mỗi ngày đóng góp ≤ 2; ghép kỳ = tổng hai nửa kỳ', () => {
    let seed = 20261118;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const statuses: DayStatus[] = [
      'PRESENT',
      'MISSING_OUT',
      'ABSENT',
      'ON_LEAVE',
      'HOLIDAY',
      'OFF',
    ];
    const types: PayrollLeaveType[] = ['ANNUAL', 'SICK', 'PERSONAL_PAID', 'UNPAID', 'OTHER'];
    for (let round = 0; round < 200; round++) {
      const statusOf = new Map<string, DayStatus>();
      const leaves: PayrollLeaveHalf[] = [];
      for (let d = 1; d <= 30; d++) {
        const date = `2026-11-${String(d).padStart(2, '0')}`;
        statusOf.set(date, statuses[rnd(statuses.length)]!);
        for (let k = rnd(4); k > 0; k--) {
          leaves.push(half(date, rnd(2) ? 'AM' : 'PM', types[rnd(types.length)]!));
        }
      }
      const startDay = 1 + rnd(30);
      const tenures = [{ from: `2026-11-${String(startDay).padStart(2, '0')}`, until: null }];
      const whole = run({ statusOf, leaves, tenures });
      const a = run({ statusOf, leaves, tenures, to: '2026-11-15' });
      const b = run({ statusOf, leaves, tenures, from: '2026-11-16' });
      if (!whole.ok || !a.ok || !b.ok) throw new Error('không mong đợi');
      const workdays = standardDaysOf({ from: tenures[0]!.from, to: '2026-11-30', schedules: [] });
      expect(whole.halfDays).toBeGreaterThanOrEqual(0);
      expect(whole.halfDays).toBeLessThanOrEqual(2 * workdays);
      expect(whole.halfDays).toBe(a.halfDays + b.halfDays);
      for (let d = 1; d <= 30; d++) {
        const date = `2026-11-${String(d).padStart(2, '0')}`;
        const one = run({ statusOf, leaves, tenures, from: date, to: date });
        expect(one.ok && one.halfDays <= 2).toBe(true);
      }
    }
  });
});

describe('standardDaysOf — SD', () => {
  const monFri: WorkSchedule = {
    effectiveFrom: '2026-11-16',
    timezone: 'Asia/Ho_Chi_Minh',
    workdays: 0b0011111, // bit 0 = thứ Hai (weekdayOf)
    startMin: 480,
    endMin: 1020,
    breakStartMin: 720,
    breakEndMin: 780,
    graceMin: 0,
  };

  it('tháng 11/2026 lịch mặc định T2–T7 = 25 ngày (lễ rơi ngày làm vẫn tính)', () => {
    expect(standardDaysOf({ from: '2026-11-01', to: '2026-11-30', schedules: [] })).toBe(25);
  });

  it('đổi lịch giữa tháng (T2–T6 từ 16/11) ⇒ tổng hai đoạn: 12 (1..15, T2–T7) + 11 (16..30, T2–T6) = 23', () => {
    expect(standardDaysOf({ from: '2026-11-01', to: '2026-11-30', schedules: [monFri] })).toBe(
      12 + 11,
    );
  });

  it('kỳ không có ngày làm việc ⇒ RangeError (S ≥ 1)', () => {
    expect(() => standardDaysOf({ from: SUN, to: SUN, schedules: [] })).toThrow(RangeError);
    expect(standardDaysOf({ from: MON, to: MON, schedules: [] })).toBe(1);
  });
});
