import { describe, expect, it } from 'vitest';

import {
  CreatePayslipRevisionBody,
  CreateSalaryProfileVersionBody,
  MoneyVnd,
  MyPayslipDto,
  MyPayslipRevisionParams,
  PAYSLIP_MAX_LINES,
  PayrollPeriod,
  PublishBlockedDetails,
  PublishPayrollBody,
  PutPayrollSettingsBody,
  PutPayslipBody,
} from './payroll.schemas';

const line = { section: 'BONUS', label: 'Thưởng kênh online', amount: 1_500_000 } as const;
const edit = { lines: [line], note: null, overrideHalfDays: null, overrideReason: null };

describe('payroll contracts (T-048, payroll.md ADR-124…127)', () => {
  it('MoneyVnd: số nguyên 0..1e12 — không float, không âm, không chuỗi', () => {
    for (const ok of [0, 7_000_000, 1e12]) expect(MoneyVnd.parse(ok)).toBe(ok);
    for (const bad of [-1, 1.5, 1e12 + 1, '7000000', Number.NaN]) {
      expect(MoneyVnd.safeParse(bad).success).toBe(false);
    }
  });

  it('PayrollPeriod YYYY-MM', () => {
    expect(PayrollPeriod.parse('2026-09')).toBe('2026-09');
    for (const bad of ['2026-9', '2026-13', '2026-00', '2026-09-01']) {
      expect(PayrollPeriod.safeParse(bad).success).toBe(false);
    }
  });

  it('PUT phiếu: ≤ 50 dòng; nhãn bắt buộc; sửa công ⇔ có lý do; strict', () => {
    expect(PutPayslipBody.parse({ ...edit, expectedLockVersion: 1 }).lines).toHaveLength(1);
    const many = Array.from({ length: PAYSLIP_MAX_LINES + 1 }, () => line);
    expect(PutPayslipBody.safeParse({ ...edit, lines: many, expectedLockVersion: 1 }).success).toBe(
      false,
    );
    for (const bad of [
      { ...edit, lines: [{ ...line, label: '  ' }] },
      { ...edit, lines: [{ ...line, amount: -1 }] },
      { ...edit, overrideHalfDays: 40 },
      { ...edit, overrideReason: 'không sửa công mà có lý do' },
      { ...edit, overrideHalfDays: 63, overrideReason: 'x' },
      { ...edit, netPay: 1 },
    ]) {
      expect(PutPayslipBody.safeParse({ ...bad, expectedLockVersion: 1 }).success).toBe(false);
    }
    expect(
      PutPayslipBody.safeParse({
        ...edit,
        overrideHalfDays: 43,
        overrideReason: 'Đi công tác 03/09',
        expectedLockVersion: 2,
      }).success,
    ).toBe(true);
  });

  it('bản điều chỉnh: lý do bắt buộc + expectedRevision', () => {
    expect(CreatePayslipRevisionBody.safeParse({ ...edit, expectedRevision: 1 }).success).toBe(
      false,
    );
    expect(
      CreatePayslipRevisionBody.safeParse({ ...edit, expectedRevision: 1, reason: 'Sai thưởng' })
        .success,
    ).toBe(true);
  });

  it('hồ sơ lương: lương cơ bản > 0; strict (không nhận hireDate — ADR-128)', () => {
    const body = { effectiveFrom: '2026-10', level: 'L2', baseSalary: 9_000_000 };
    expect(CreateSalaryProfileVersionBody.parse(body)).toEqual(body);
    expect(CreateSalaryProfileVersionBody.safeParse({ ...body, baseSalary: 0 }).success).toBe(
      false,
    );
    expect(
      CreateSalaryProfileVersionBody.safeParse({ ...body, hireDate: '2020-01-01' }).success,
    ).toBe(false);
  });

  it('phát hành: confirmed phải là true; PUBLISH_BLOCKED liệt kê lý do', () => {
    expect(PublishPayrollBody.safeParse({ confirmed: false }).success).toBe(false);
    expect(PublishPayrollBody.safeParse({ confirmed: true }).success).toBe(true);
    const details = {
      rule: 'PUBLISH_BLOCKED',
      blockers: [
        {
          userId: '00000000-0000-7000-8000-000000000001',
          reasons: ['NEGATIVE_NET_PAY', 'MISSING_HIRE_DATE'],
        },
      ],
    };
    expect(PublishBlockedDetails.parse(details)).toEqual(details);
    expect(
      PublishBlockedDetails.safeParse({
        ...details,
        blockers: [{ ...details.blockers[0], reasons: ['MISSING_OUT'] }],
      }).success,
    ).toBe(false);
  });

  it('cài đặt + tham số; phiếu của nhân viên không có lockVersion', () => {
    expect(PutPayrollSettingsBody.safeParse({ seniorityPerYear: 500_000 }).success).toBe(false);
    expect(MyPayslipRevisionParams.parse({ period: '2026-09', revision: '2' })).toEqual({
      period: '2026-09',
      revision: 2,
    });
    expect(Object.keys(MyPayslipDto.shape)).not.toContain('lockVersion');
    // Lý do sửa công là ghi chú nội bộ (có thể nhắc sức khỏe) — nhân viên không thấy; lý do điều chỉnh thì thấy.
    expect(Object.keys(MyPayslipDto.shape)).not.toContain('overrideReason');
    expect(Object.keys(MyPayslipDto.shape)).toContain('revisionReason');
  });
});
