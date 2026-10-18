import { describe, expect, it } from 'vitest';

import {
  completedYears,
  computePayslip,
  daysInMonth,
  periodLastDay,
  salaryByDays,
  seniorityAllowanceOf,
  type PayslipMathLine,
} from './payslip-math';
import { MAX_MONEY_VND, MAX_PAYSLIP_LINES } from './limits';

// payroll.md §7 — PR (computePayslip) + SN (thâm niên) phần hàm thuần (T-049).

describe('salaryByDays — half-up MỘT lần trên lương cơ bản', () => {
  it('đi đủ công chuẩn ⇒ đủ lương; trần h ≤ 2S', () => {
    expect(salaryByDays(10_000_000, 44, 22)).toBe(10_000_000);
    expect(salaryByDays(10_000_000, 62, 22)).toBe(10_000_000);
    expect(salaryByDays(10_000_000, 0, 22)).toBe(0);
  });

  it('half-up: 10.000.000 × 21,5/22 = 9.772.727,27 ⇒ 9.772.727; 1 × 1/2 ngày / 1 = 0,5 ⇒ 1; 0,25 ⇒ 0', () => {
    expect(salaryByDays(10_000_000, 43, 22)).toBe(9_772_727);
    expect(salaryByDays(1, 1, 1)).toBe(1); // 1 × 0,5 = 0,5 ⇒ lên
    expect(salaryByDays(1, 1, 2)).toBe(0); // 1 × 0,5 / 2 = 0,25 ⇒ xuống
    expect(salaryByDays(3, 1, 2)).toBe(1); // 0,75 ⇒ lên
    expect(salaryByDays(5, 2, 4)).toBe(1); // 1,25 ⇒ xuống
    expect(salaryByDays(6, 3, 4)).toBe(2); // 2,25 ⇒ xuống
    expect(salaryByDays(2, 3, 4)).toBe(1); // 0,75 ⇒ lên
  });

  it('biên an toàn: 1e12 × 62 nửa / 31 ngày ⇒ đúng 1e12 (2·1e12·62 < 2^53)', () => {
    expect(salaryByDays(MAX_MONEY_VND, 62, 31)).toBe(MAX_MONEY_VND);
    expect(salaryByDays(MAX_MONEY_VND, 1, 31)).toBe(16_129_032_258); // 1e12 / 62 = 16.129.032.258,06
  });

  it('đầu vào sai ⇒ RangeError (S < 1, h ngoài 0..62, số lẻ, âm, vượt trần)', () => {
    for (const [b, h, s] of [
      [1, 1, 0],
      [1, 63, 31],
      [1, -1, 22],
      [1, 1.5, 22],
      [-1, 1, 22],
      [MAX_MONEY_VND + 1, 1, 22],
      [1, 1, 32],
    ] as const) {
      expect(() => salaryByDays(b, h, s), `${String(b)} ${String(h)} ${String(s)}`).toThrow(
        RangeError,
      );
    }
  });
});

describe('computePayslip (ADR-125)', () => {
  const line = (section: PayslipMathLine['section'], amount: number): PayslipMathLine => ({
    section,
    amount,
  });

  it('(1) = lương theo công + thâm niên + INCOME; (2) = BONUS; (3) = DEDUCTION; (4) = (1)+(2)−(3)', () => {
    expect(
      computePayslip({
        baseSalary: 10_000_000,
        paidHalfDays: 43,
        standardDays: 22,
        seniorityAllowance: 1_500_000,
        lines: [
          line('INCOME', 300_000),
          line('BONUS', 2_000_000),
          line('BONUS', 500_000),
          line('DEDUCTION', 1_050_000),
          line('DEDUCTION', 200_000),
        ],
      }),
    ).toEqual({
      salaryByDays: 9_772_727,
      seniorityAllowance: 1_500_000,
      incomeTotal: 11_572_727,
      bonusTotal: 2_500_000,
      deductionTotal: 1_250_000,
      netPay: 12_822_727,
    });
  });

  it('thực lĩnh âm được TRẢ VỀ (cấm phát hành ở use case — NEGATIVE_NET_PAY), không ném', () => {
    expect(
      computePayslip({
        baseSalary: 1_000,
        paidHalfDays: 0,
        standardDays: 22,
        seniorityAllowance: 0,
        lines: [line('DEDUCTION', 5_000)],
      }).netPay,
    ).toBe(-5_000);
  });

  it('≤ 50 dòng; 51 ⇒ RangeError; 50 dòng × 1e12 vẫn số nguyên an toàn', () => {
    const many = (n: number) => Array.from({ length: n }, () => line('BONUS', MAX_MONEY_VND));
    const base = {
      baseSalary: MAX_MONEY_VND,
      paidHalfDays: 62,
      standardDays: 31,
      seniorityAllowance: MAX_MONEY_VND,
    };
    const totals = computePayslip({ ...base, lines: many(MAX_PAYSLIP_LINES) });
    expect(totals.bonusTotal).toBe(50 * MAX_MONEY_VND);
    expect(Object.values(totals).every(Number.isSafeInteger)).toBe(true);
    expect(() => computePayslip({ ...base, lines: many(51) })).toThrow(RangeError);
  });

  it('dòng âm / lẻ / vượt trần, thâm niên âm ⇒ RangeError', () => {
    const base = { baseSalary: 1, paidHalfDays: 1, standardDays: 1, seniorityAllowance: 0 };
    for (const amount of [-1, 0.5, MAX_MONEY_VND + 1]) {
      expect(() => computePayslip({ ...base, lines: [line('INCOME', amount)] })).toThrow(
        RangeError,
      );
    }
    expect(() => computePayslip({ ...base, seniorityAllowance: -1, lines: [] })).toThrow(
      RangeError,
    );
  });

  it('parity: tính lại từ cùng dòng ⇒ cùng tổng (hàm thuần, thứ tự dòng không đổi kết quả)', () => {
    const lines = [line('BONUS', 7), line('DEDUCTION', 3), line('INCOME', 11)];
    const input = {
      baseSalary: 9_999_999,
      paidHalfDays: 37,
      standardDays: 23,
      seniorityAllowance: 500_000,
    };
    expect(computePayslip({ ...input, lines })).toEqual(
      computePayslip({ ...input, lines: [...lines].reverse() }),
    );
  });
});

describe('ngày & thâm niên (chuỗi thuần)', () => {
  it('daysInMonth / periodLastDay: tháng 2 nhuận (2028, 2000) / không nhuận (2026, 2100)', () => {
    expect([2026, 2028, 2000, 2100].map((y) => daysInMonth(y, 2))).toEqual([28, 29, 29, 28]);
    expect([1, 4, 6, 9, 11, 12].map((m) => daysInMonth(2026, m))).toEqual([31, 30, 30, 30, 30, 31]);
    expect(periodLastDay('2028-02')).toBe('2028-02-29');
    expect(periodLastDay('2026-11')).toBe('2026-11-30');
    for (const bad of ['2026-13', '2026-1', '26-01'])
      expect(() => periodLastDay(bad)).toThrow(RangeError);
  });

  it('SN < 1 năm = 0; tròn năm đúng ngày cuối kỳ ⇒ tính; ngày 1 tháng sau ⇒ chưa', () => {
    expect(completedYears('2026-03-01', '2026-11-30')).toBe(0);
    expect(completedYears('2023-11-30', '2026-11-30')).toBe(3);
    expect(completedYears('2023-12-01', '2026-11-30')).toBe(2);
    expect(completedYears('2026-11-30', '2026-11-30')).toBe(0);
  });

  it('SN hireDate 29/02: kỳ 02/2025 (kỷ niệm 28/02) đủ 1 năm; 02/2028 kỷ niệm 29/02', () => {
    expect(completedYears('2024-02-29', '2025-02-28')).toBe(1);
    expect(completedYears('2024-02-29', '2025-02-27')).toBe(0);
    expect(completedYears('2024-02-29', '2028-02-29')).toBe(4);
    expect(completedYears('2024-02-29', '2028-02-28')).toBe(3);
  });

  it('SN hireDate 31/01: kỳ tháng 2 / tháng 4 (kỷ niệm 31/01 đã qua)', () => {
    expect(completedYears('2025-01-31', '2026-02-28')).toBe(1);
    expect(completedYears('2025-01-31', '2026-04-30')).toBe(1);
    expect(completedYears('2025-01-31', '2026-01-30')).toBe(0);
  });

  it('hireDate sau ngày cuối kỳ ⇒ null (cờ chặn phát hành); ngày sai dạng ⇒ RangeError', () => {
    expect(completedYears('2026-12-01', '2026-11-30')).toBeNull();
    expect(() => completedYears('2026-1-01', '2026-11-30')).toThrow(RangeError);
  });

  it('seniorityAllowanceOf = mức × năm, < 1 năm = 0; trần 1e12', () => {
    expect(seniorityAllowanceOf(500_000, 0)).toBe(0);
    expect(seniorityAllowanceOf(500_000, 3)).toBe(1_500_000);
    expect(() => seniorityAllowanceOf(MAX_MONEY_VND, 2)).toThrow(RangeError);
    expect(() => seniorityAllowanceOf(-1, 2)).toThrow(RangeError);
  });
});

describe('B review T-049', () => {
  it('HIGH-1: message lỗi KHÔNG chứa giá trị tiền (error handler / Sentry ghi message — SEC-PAY-09)', () => {
    const cases: (() => unknown)[] = [
      () => salaryByDays(9_876_543.5, 1, 1),
      () => salaryByDays(-9_876_543, 1, 1),
      () =>
        computePayslip({
          baseSalary: 1,
          paidHalfDays: 1,
          standardDays: 1,
          seniorityAllowance: -9_876_543,
          lines: [],
        }),
      () =>
        computePayslip({
          baseSalary: 1,
          paidHalfDays: 1,
          standardDays: 1,
          seniorityAllowance: 0,
          lines: [{ section: 'BONUS', amount: 9_876_543.5 }],
        }),
      () => seniorityAllowanceOf(9_876_543_000_000, 2),
    ];
    for (const run of cases) {
      let caught: unknown;
      try {
        run();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RangeError);
      expect(String(caught)).not.toMatch(/9876543|9\.876\.543|9,876,543/);
    }
  });

  it('L1: số năm thâm niên ≤ 80 (= CHECK DB); 81 ⇒ RangeError', () => {
    expect(seniorityAllowanceOf(1, 80)).toBe(80);
    expect(() => seniorityAllowanceOf(1, 81)).toThrow(RangeError);
  });

  it('L2: ngày không tồn tại (tháng 13, 30/02, 29/02 năm không nhuận) ⇒ RangeError; 29/02 năm nhuận được', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '2026-02-29', '2026-04-31', '2026-00-10']) {
      expect(() => completedYears(bad, '2027-01-01'), bad).toThrow(RangeError);
    }
    expect(completedYears('2028-02-29', '2029-03-01')).toBe(1);
  });
});

describe('Stryker payroll-math (T-049): message nêu đúng trường, regex neo hai đầu, biên', () => {
  const base = {
    baseSalary: 1,
    paidHalfDays: 1,
    standardDays: 1,
    seniorityAllowance: 0,
    lines: [],
  };

  it('RangeError nêu TÊN trường + khoảng (không giá trị) — web / log biết sai ở đâu', () => {
    expect(() => salaryByDays(-1, 1, 1)).toThrow(
      /^baseSalary phải là số nguyên trong \[0, 1000000000000\]$/,
    );
    expect(() => salaryByDays(1, 63, 1)).toThrow(
      /^paidHalfDays phải là số nguyên trong \[0, 62\]$/,
    );
    expect(() => salaryByDays(1, 1, 0)).toThrow(/^standardDays phải là số nguyên trong \[1, 31\]$/);
    expect(() => computePayslip({ ...base, seniorityAllowance: -1 })).toThrow(
      /^seniorityAllowance /,
    );
    expect(() => computePayslip({ ...base, lines: [{ section: 'BONUS', amount: -1 }] })).toThrow(
      /^amount /,
    );
    expect(() =>
      computePayslip({
        ...base,
        lines: Array.from({ length: MAX_PAYSLIP_LINES + 1 }, () => ({
          section: 'BONUS' as const,
          amount: 1,
        })),
      }),
    ).toThrow(/^Tối đa 50 dòng \/ phiếu$/);
    expect(() => seniorityAllowanceOf(-1, 1)).toThrow(/^seniorityPerYear /);
    expect(() => seniorityAllowanceOf(1, 81)).toThrow(/^seniorityYears /);
    expect(() => seniorityAllowanceOf(MAX_MONEY_VND, 2)).toThrow(/^seniorityAllowance vượt trần$/);
    expect(() => completedYears('2026-1-01', '2026-11-30')).toThrow(
      /^Ngày phải có dạng YYYY-MM-DD: /,
    );
    expect(() => completedYears('2026-02-30', '2026-11-30')).toThrow(/^Ngày không tồn tại: /);
    expect(() => periodLastDay('2026-13')).toThrow(/^Kỳ lương phải có dạng YYYY-MM: /);
  });

  it('ngày / kỳ phải khớp CẢ chuỗi (không tiền tố / hậu tố); ngày 00 không tồn tại', () => {
    for (const bad of ['x2026-11-30', '2026-11-30x', '2026-11-30T00:00', '2026-01-00']) {
      expect(() => completedYears(bad, '2027-01-01'), bad).toThrow(RangeError);
    }
    for (const bad of ['x2026-11', '2026-11x', '2026-11-01']) {
      expect(() => periodLastDay(bad), bad).toThrow(RangeError);
    }
  });

  it('thâm niên đúng bằng trần 1e12 được; vượt một đồng ⇒ RangeError', () => {
    expect(seniorityAllowanceOf(MAX_MONEY_VND, 1)).toBe(MAX_MONEY_VND);
    expect(seniorityAllowanceOf(MAX_MONEY_VND / 2, 2)).toBe(MAX_MONEY_VND);
    expect(() => seniorityAllowanceOf(MAX_MONEY_VND / 2 + 1, 2)).toThrow(RangeError);
  });
});
