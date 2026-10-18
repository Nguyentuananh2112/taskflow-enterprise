import { PublishBlockReason as ContractReason } from '@taskflow/contracts/payroll';
import { describe, expect, it } from 'vitest';

import {
  payslipNumbers,
  profileFor,
  staleReasons,
  type PayslipNumbersInput,
  type PublishBlockReason,
} from './payslip-numbers';

// payroll.md §7 — SN / PR ở mức phiếu (T-049): thâm niên theo hireDate tới ngày cuối kỳ, không chia công, cờ chặn.
const base: PayslipNumbersInput = {
  period: '2026-11',
  profile: { level: 'L2', baseSalary: 10_000_000 },
  hireDate: '2023-11-30',
  seniorityPerYear: 500_000,
  standardDays: 25,
  paidHalfDays: 50,
  overrideHalfDays: null,
  lines: [],
};

describe('payslipNumbers', () => {
  it('đi đủ công + 3 năm tròn đúng ngày cuối kỳ ⇒ đủ lương + 1.500.000 thâm niên; không cờ', () => {
    expect(payslipNumbers(base)).toMatchObject({
      salaryByDays: 10_000_000,
      seniorityYears: 3,
      seniorityAllowance: 1_500_000,
      incomeTotal: 11_500_000,
      netPay: 11_500_000,
      countedHalfDays: 50,
      blockReasons: [],
    });
  });

  it('thâm niên KHÔNG chia theo công: h = 0 vẫn đủ thâm niên; tròn năm ngày 1 tháng sau ⇒ chưa tính', () => {
    expect(payslipNumbers({ ...base, paidHalfDays: 0 })).toMatchObject({
      salaryByDays: 0,
      seniorityAllowance: 1_500_000,
    });
    expect(payslipNumbers({ ...base, hireDate: '2023-12-01' }).seniorityYears).toBe(2);
  });

  it('sửa công (override) thắng công chấm, trần 2S; dòng gõ tay vào đúng mục', () => {
    const r = payslipNumbers({
      ...base,
      overrideHalfDays: 62,
      lines: [
        { section: 'BONUS', amount: 2_000_000 },
        { section: 'DEDUCTION', amount: 1_050_000 },
      ],
    });
    expect(r.countedHalfDays).toBe(50);
    expect(r).toMatchObject({
      bonusTotal: 2_000_000,
      deductionTotal: 1_050_000,
      netPay: 12_450_000,
    });
  });

  it('cờ chặn: thiếu hồ sơ (lương 0), thiếu hireDate, hireDate sau kỳ (thâm niên 0), thực lĩnh âm — đủ mọi lý do', () => {
    expect(
      payslipNumbers({
        ...base,
        profile: null,
        hireDate: null,
        lines: [{ section: 'DEDUCTION', amount: 1 }],
      }).blockReasons,
    ).toEqual(['MISSING_SALARY_PROFILE', 'MISSING_HIRE_DATE', 'NEGATIVE_NET_PAY']);
    const after = payslipNumbers({ ...base, hireDate: '2026-12-01' });
    expect(after).toMatchObject({ seniorityYears: 0, seniorityAllowance: 0 });
    expect(after.blockReasons).toEqual(['HIRE_DATE_AFTER_PERIOD']);
  });
});

describe('profileFor / staleReasons', () => {
  it('phiên bản effectiveFrom ≤ kỳ, muộn nhất; không có ⇒ null', () => {
    const v = [
      { effectiveFrom: '2026-01' },
      { effectiveFrom: '2026-11' },
      { effectiveFrom: '2027-01' },
    ];
    expect(profileFor(v, '2026-10')).toEqual({ effectiveFrom: '2026-01' });
    expect(profileFor(v, '2026-11')).toEqual({ effectiveFrom: '2026-11' });
    expect(profileFor(v, '2025-12')).toBeNull();
  });

  it('cờ cần tính lại: hireDate ảnh chụp ≠ hiện hành; mức thâm niên của bảng ≠ cài đặt', () => {
    const same = {
      snapshotHireDate: 'a',
      currentHireDate: 'a',
      runSeniorityPerYear: 1,
      currentSeniorityPerYear: 1,
    };
    expect(staleReasons(same)).toEqual([]);
    expect(staleReasons({ ...same, currentHireDate: null, currentSeniorityPerYear: 2 })).toEqual([
      'HIRE_DATE_CHANGED',
      'SENIORITY_RATE_CHANGED',
    ]);
  });

  it('parity: PublishBlockReason domain = contracts', () => {
    const domain: PublishBlockReason[] = [
      'NEGATIVE_NET_PAY',
      'MISSING_SALARY_PROFILE',
      'MISSING_HIRE_DATE',
      'HIRE_DATE_AFTER_PERIOD',
      'HIRE_DATE_CHANGED',
      'SENIORITY_RATE_CHANGED',
    ];
    expect([...ContractReason.options].sort()).toEqual([...domain].sort());
  });
});
