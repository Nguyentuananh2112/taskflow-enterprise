import { describe, expect, it } from 'vitest';

import type { CalendarDay, LeaveSpan } from './leave-days';
import {
  LEGAL_LEAVE_POLICY,
  annualBalance,
  carriedOverOf,
  carryOverExpiresOn,
  continuousInto,
  entitlementOf,
  fullYearsBetween,
  resolvePolicy,
  seniorityYearsAt,
  splitAtExpiry,
  type LeavePolicy,
} from './leave-policy';

// T-057 (hr-extended.md ADR-131; test-spec LP-01…LP-13 ở mức hàm thuần). Dữ liệu bịa.

const P = (over: Partial<LeavePolicy> = {}): LeavePolicy => ({ ...LEGAL_LEAVE_POLICY, ...over });
const ALL_YEAR = { from: '2020-01-06', until: null };

describe('LP-01 chọn chính sách', () => {
  const rows = [
    { year: 2024, policy: P({ annual: 28 }) },
    { year: 2026, policy: P({ annual: 30 }) },
  ];
  it('năm có dòng ⇒ SET; không ⇒ dòng gần nhất TRƯỚC đó; không có ⇒ mức luật', () => {
    expect(resolvePolicy(rows, 2026)).toMatchObject({ source: 'SET', fromYear: 2026 });
    expect(resolvePolicy(rows, 2025)).toMatchObject({
      source: 'INHERITED',
      fromYear: 2024,
      policy: { annual: 28 },
    });
    expect(resolvePolicy(rows, 2030)).toMatchObject({ source: 'INHERITED', fromYear: 2026 });
    expect(resolvePolicy(rows, 2023)).toEqual({
      policy: LEGAL_LEAVE_POLICY,
      source: 'DEFAULT',
      fromYear: null,
    });
    expect(resolvePolicy([], 2026).source).toBe('DEFAULT');
  });
});

describe('LP-02 thâm niên tới 31/12/Y', () => {
  it('năm tròn theo chuỗi ngày; 29/02', () => {
    expect(fullYearsBetween('2021-03-10', '2026-03-09')).toBe(4);
    expect(fullYearsBetween('2021-03-10', '2026-03-10')).toBe(5);
    expect(fullYearsBetween('2024-02-29', '2025-02-28')).toBe(0);
    expect(fullYearsBetween('2024-02-29', '2025-03-01')).toBe(1);
    expect(fullYearsBetween('2026-05-01', '2026-01-01')).toBe(0);
  });

  it('4 năm 364 ngày ⇒ 12; đủ 5 năm đúng 31/12/Y ⇒ +1 ngay năm Y', () => {
    const ent = (hireDate: string, year: number) =>
      entitlementOf({ policy: P(), year, hireDate, tenure: ALL_YEAR, override: null });
    expect(seniorityYearsAt('2022-01-01', 2026)).toBe(4);
    expect(ent('2022-01-01', 2026)).toMatchObject({ entitled: 24, bonus: 0, seniorityYears: 4 });
    expect(ent('2021-12-31', 2026)).toMatchObject({ entitled: 26, bonus: 2, seniorityYears: 5 });
    expect(ent('2016-06-01', 2026)).toMatchObject({ entitled: 28, seniorityYears: 10 });
    // Bậc 3 năm, +1,5 ngày/bậc.
    expect(
      entitlementOf({
        policy: P({ seniorityStepYears: 3, seniorityBonus: 3 }),
        year: 2026,
        hireDate: '2019-07-01',
        tenure: ALL_YEAR,
        override: null,
      }),
    ).toMatchObject({ entitled: 30, bonus: 6 });
  });
});

describe('LP-03/04/05/13 nhiệm kỳ, thiếu ngày vào, ghi đè', () => {
  const ent = (
    tenure: { from: string; until: string | null } | null,
    hireDate: string | null = null,
    override: number | null = null,
  ) => entitlementOf({ policy: P(), year: 2026, hireDate, tenure, override });

  it('LP-03 vào 01/01, 20/07, 31/12 ⇒ đủ base, không tỷ lệ; năm sau vẫn base', () => {
    for (const from of ['2026-01-01', '2026-07-20', '2026-12-31']) {
      expect(ent({ from, until: null }, from)).toMatchObject({ base: 24, entitled: 24 });
    }
    expect(
      entitlementOf({
        policy: P(),
        year: 2027,
        hireDate: '2026-07-20',
        tenure: { from: '2026-07-20', until: null },
        override: null,
      }).entitled,
    ).toBe(24);
  });

  it('ngày hiệu lực = max(hireDate, start_date): ngày vào sau 31/12/Y ⇒ 0', () => {
    expect(ent({ from: '2026-03-01', until: null }, '2027-01-02').entitled).toBe(0);
  });

  it('LP-04 không ngày vào ⇒ annual + cờ thiếu; năm không giao nhiệm kỳ ⇒ 0', () => {
    expect(ent(ALL_YEAR)).toMatchObject({
      entitled: 24,
      missingHireDate: true,
      seniorityYears: null,
    });
    expect(ent(null).entitled).toBe(0);
    expect(ent({ from: '2027-02-01', until: null }).entitled).toBe(0);
    expect(ent({ from: '2020-01-01', until: '2025-12-31' }).entitled).toBe(0);
  });

  it('LP-05 ghi đè khác null thắng (kể cả 0), nguồn OVERRIDE; base vẫn báo theo chính sách', () => {
    expect(ent(ALL_YEAR, '2010-01-01', 20)).toMatchObject({
      entitled: 20,
      source: 'OVERRIDE',
      base: 30, // vào 2010 ⇒ 16 năm ⇒ 3 bậc × 1 ngày
    });
    expect(ent(ALL_YEAR, null, 0)).toMatchObject({ entitled: 0, source: 'OVERRIDE' });
  });

  it('LP-13 nhận lại năm khác ⇒ đủ base theo nhiệm kỳ mới (thâm niên theo hireDate giữ lại)', () => {
    expect(ent({ from: '2026-05-04', until: null }, '2019-01-01')).toMatchObject({
      entitled: 26,
      seniorityYears: 7,
    });
  });
});

describe('LP-06/06b phép chuyển sang', () => {
  const on = P({ carryOverEnabled: true, carryOverMax: 10 });
  it('tắt ⇒ 0; trần; âm ⇒ 0; không liên tục ⇒ 0', () => {
    expect(carriedOverOf({ previousPolicy: P(), continuous: true, remainingAtYearEnd: 8 })).toBe(0);
    expect(carriedOverOf({ previousPolicy: on, continuous: true, remainingAtYearEnd: 8 })).toBe(8);
    expect(carriedOverOf({ previousPolicy: on, continuous: true, remainingAtYearEnd: 30 })).toBe(
      10,
    );
    expect(carriedOverOf({ previousPolicy: on, continuous: true, remainingAtYearEnd: -3 })).toBe(0);
    expect(carriedOverOf({ previousPolicy: on, continuous: false, remainingAtYearEnd: 8 })).toBe(0);
  });

  it('liên tục = MỘT nhiệm kỳ chứa cả 31/12/(Y−1) và 01/01/Y', () => {
    expect(continuousInto([{ from: '2024-03-01', until: null }], 2026)).toBe(true);
    expect(continuousInto([{ from: '2024-03-01', until: '2026-01-01' }], 2026)).toBe(true);
    // Nghỉ 20/12, nhận lại 05/01 ⇒ hai nhiệm kỳ, không liên tục.
    expect(
      continuousInto(
        [
          { from: '2024-03-01', until: '2025-12-20' },
          { from: '2026-01-05', until: null },
        ],
        2026,
      ),
    ).toBe(false);
    // Nâng Admin 31/12 (nhiệm kỳ đóng đúng 31/12) ⇒ không có ngày 01/01.
    expect(continuousInto([{ from: '2024-03-01', until: '2025-12-31' }], 2026)).toBe(false);
    // Vào làm 01/01/Y ⇒ không có 31/12/(Y−1).
    expect(continuousInto([{ from: '2026-01-01', until: null }], 2026)).toBe(false);
  });
});

describe('LP-07/08 hạn phép chuyển sang và kiểm số dư', () => {
  it('hạn = ngày cuối tháng (tháng 2 nhuận / không nhuận, tháng 12)', () => {
    expect(carryOverExpiresOn(2026, 3)).toBe('2026-03-31');
    expect(carryOverExpiresOn(2028, 2)).toBe('2028-02-29');
    expect(carryOverExpiresOn(2027, 2)).toBe('2027-02-28');
    expect(carryOverExpiresOn(2026, 12)).toBe('2026-12-31');
    expect(carryOverExpiresOn(2026, 4)).toBe('2026-04-30');
  });

  const workdays = (from: string, to: string): CalendarDay[] => {
    const out: CalendarDay[] = [];
    for (
      let t = Date.parse(`${from}T00:00:00Z`);
      t <= Date.parse(`${to}T00:00:00Z`);
      t += 86_400_000
    ) {
      const date = new Date(t).toISOString().slice(0, 10);
      const dow = new Date(t).getUTCDay();
      out.push({ date, isWorkday: dow !== 0, isHoliday: false });
    }
    return out;
  };
  const cal = workdays('2026-03-25', '2026-04-10');
  const span = (startDate: string, endDate: string): LeaveSpan => ({
    startDate,
    endDate,
    dayPart: 'FULL',
  });

  it('tách đơn ở biên E / E+1 (31/03 | 01/04), theo nhiệm kỳ', () => {
    // 30/03 (T2) … 02/04 (T5) = 4 ngày: 2 trước hạn, 2 sau.
    expect(splitAtExpiry(span('2026-03-30', '2026-04-02'), cal, ALL_YEAR, '2026-03-31')).toEqual({
      early: 4,
      late: 4,
    });
    expect(splitAtExpiry(span('2026-03-31', '2026-03-31'), cal, ALL_YEAR, '2026-03-31')).toEqual({
      early: 2,
      late: 0,
    });
    expect(splitAtExpiry(span('2026-04-01', '2026-04-01'), cal, ALL_YEAR, '2026-03-31')).toEqual({
      early: 0,
      late: 2,
    });
    // Nhiệm kỳ kết thúc 30/03 ⇒ chỉ đếm 30/03.
    expect(
      splitAtExpiry(
        span('2026-03-30', '2026-04-02'),
        cal,
        { from: '2020-01-06', until: '2026-03-30' },
        '2026-03-31',
      ),
    ).toEqual({ early: 2, late: 0 });
    // Nhiệm kỳ bắt đầu 02/04 ⇒ chỉ đếm 02/04 (sau hạn).
    expect(
      splitAtExpiry(
        span('2026-03-30', '2026-04-02'),
        cal,
        { from: '2026-04-02', until: null },
        '2026-03-31',
      ),
    ).toEqual({ early: 0, late: 2 });
  });

  it('phép chuyển sang trừ trước, chỉ cho phần ≤ hạn; hết hạn thì phần chưa dùng mất (LP-08)', () => {
    const base = { entitled: 24, adjustment: 0, carried: 6, expiresOn: '2026-03-31' };
    // Dùng 4 nửa ngày trước hạn: lấy từ carried ⇒ budget nguyên; còn carried 2 dùng được tới hạn.
    expect(
      annualBalance({ ...base, usedEarly: 4, usedLate: 0, today: '2026-03-10' }),
    ).toMatchObject({ covers: true, carriedUsable: 2, remaining: 26 });
    // Sau hạn: carried chưa dùng mất.
    expect(
      annualBalance({ ...base, usedEarly: 4, usedLate: 0, today: '2026-04-01' }),
    ).toMatchObject({ carriedUsable: 0, remaining: 24 });
    // Dùng 10 trước hạn: 6 từ carried, 4 từ budget.
    expect(
      annualBalance({ ...base, usedEarly: 10, usedLate: 0, today: '2026-03-10' }),
    ).toMatchObject({ carriedUsable: 0, remaining: 20 });
    // Phần sau hạn không dùng được carried.
    expect(
      annualBalance({ ...base, usedEarly: 0, usedLate: 24, today: '2026-03-10' }),
    ).toMatchObject({ covers: true, remaining: 6 });
    expect(annualBalance({ ...base, usedEarly: 0, usedLate: 26, today: '2026-03-10' }).covers).toBe(
      false,
    );
    expect(
      annualBalance({ ...base, usedEarly: 30, usedLate: 0, today: '2026-03-10' }),
    ).toMatchObject({
      covers: true,
      remaining: 0,
    });
    expect(annualBalance({ ...base, usedEarly: 31, usedLate: 0, today: '2026-03-10' }).covers).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------- property test (PRNG có seed — tất định)

function prng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s % n;
  };
}

describe('property (ADR-131 §9): entitled ∈ {0, base}; base không giảm theo năm; covers ⇒ remaining ≥ 0', () => {
  it('1 000 bộ ngẫu nhiên', () => {
    const r = prng(20_261_017);
    for (let i = 0; i < 1_000; i++) {
      const policy = P({
        annual: 24 + r(37),
        seniorityStepYears: 1 + r(5),
        seniorityBonus: 2 + r(9),
        carryOverEnabled: r(2) === 1,
        carryOverMax: r(61),
        carryOverExpiryMonth: 1 + r(12),
      });
      const hireDate = `${String(2000 + r(27))}-${String(1 + r(12)).padStart(2, '0')}-${String(1 + r(28)).padStart(2, '0')}`;
      const tenure = { from: hireDate, until: null };
      const year = 2020 + r(10);
      const e = entitlementOf({ policy, year, hireDate, tenure, override: null });
      expect([0, e.base]).toContain(e.entitled);
      const next = entitlementOf({ policy, year: year + 1, hireDate, tenure, override: null });
      expect(next.base).toBeGreaterThanOrEqual(e.base);

      const carried = r(21);
      const bal = annualBalance({
        entitled: e.entitled,
        adjustment: r(21) - 10,
        carried,
        usedEarly: r(40),
        usedLate: r(40),
        today: `${String(year)}-0${String(1 + r(9))}-15`,
        expiresOn: carryOverExpiresOn(year, policy.carryOverExpiryMonth),
      });
      if (bal.covers) expect(bal.remaining).toBeGreaterThanOrEqual(0);
      expect(bal.carriedUsable).toBeLessThanOrEqual(carried);
    }
  });
});
