import { describe, expect, it } from 'vitest';

import type { RawResponse } from './http-client';
import {
  PAYROLL,
  expectNoMoney,
  moneyMarker,
  moneySpellings,
  payrollMonth,
  publishBlockers,
} from './payroll';

// Harness Mốc 4 (test-spec-payroll §1.2): phần thuần — mốc kỳ lương, số đánh dấu, đọc lỗi PUBLISH_BLOCKED.

const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);
const FROM = new Date('2026-10-17T05:00:00Z'); // 17/10/2026 12:00 VN

const res = (status: number, json: unknown): RawResponse => ({
  status,
  headers: {},
  text: JSON.stringify(json),
  json,
});

describe('payrollMonth', () => {
  it('kỳ đầu = tháng kế tiếp có ngày 1 ≥ hôm nay + 2; runAnchor = ngày 2 tháng sau 10:00 VN', () => {
    const m = payrollMonth({ from: FROM });
    expect(m).toMatchObject({
      period: '2026-11',
      startAnchor: '2026-11-01T03:00:00.000Z',
      runAnchor: '2026-12-02T03:00:00.000Z',
    });
    expect(m.days).toHaveLength(30);
    expect(m.days[0]).toBe('2026-11-01');
    expect(m.days.at(-1)).toBe('2026-11-30');
  });

  it('kỳ sau (`after`) luôn ở sau runAnchor của kỳ trước — mốc chỉ tiến', () => {
    const a = payrollMonth({ from: FROM });
    const b = payrollMonth({ after: a });
    expect(b.period).toBe('2027-01');
    expect(Date.parse(b.startAnchor)).toBeGreaterThan(Date.parse(a.runAnchor));
    expect(payrollMonth({ after: b }).period).toBe('2027-03');
  });

  it('tháng 2 năm nhuận; runDay tùy chọn (CLK nhắc ngày 5 / 11)', () => {
    const feb = payrollMonth({ from: new Date('2028-01-20T00:00:00Z'), runDay: 5 });
    expect(feb.period).toBe('2028-02');
    expect(feb.days).toHaveLength(29);
    expect(feb.runAnchor).toBe('2028-03-05T03:00:00.000Z');
  });
});

describe('PAYROLL', () => {
  it('route theo contracts T-048', () => {
    expect(PAYROLL.payslip('2026-11', 'u1')).toBe('/payroll/runs/2026-11/payslips/u1');
    expect(PAYROLL.recalculatePreview('2026-11')).toBe('/payroll/runs/2026-11/recalculate/preview');
    expect(PAYROLL.mySlipRevision('2026-11', 2)).toBe('/payslips/2026-11/revisions/2');
  });
});

describe('không lộ tiền', () => {
  it('moneyMarker: 7 chữ số, không tròn, khác nhau theo seed', () => {
    const a = moneyMarker(1);
    const b = moneyMarker(2);
    expect(String(a)).toMatch(/^7\d{6}$/);
    expect(a % 1000).not.toBe(0);
    expect(a).not.toBe(b);
    expect(Number.isSafeInteger(moneyMarker())).toBe(true);
  });

  it('moneySpellings: mọi cách viết nhóm nghìn', () => {
    expect(moneySpellings(7031117)).toEqual([
      '7031117',
      '7.031.117',
      '7,031,117',
      '7 031 117',
      `7${NBSP}031${NBSP}117`,
      `7${NNBSP}031${NNBSP}117`,
    ]);
  });

  it('expectNoMoney bắt cả chuỗi lẫn object; không báo nhầm số khác', () => {
    expect(() => expectNoMoney(7031117, { log: 'netPay=7.031.117' })).toThrow(/log/);
    expect(() =>
      expectNoMoney(7031117, { notif: { body: `Lương 7${NBSP}031${NBSP}117 ₫` } }),
    ).toThrow();
    expect(() => expectNoMoney(7031117, { log: 'id 70311170 a', n: { x: 7031118 } })).not.toThrow();
    expect(() => expectNoMoney(7031117, { log: 'v 17.031.117 / 7.031.1170' })).not.toThrow();
    expect(() => expectNoMoney(7031117, { log: 'tổng: 7031117.' })).toThrow();
  });
});

describe('publishBlockers', () => {
  const body = (blockers: unknown, rule = 'PUBLISH_BLOCKED', code = 'BUSINESS_RULE_VIOLATION') => ({
    success: false,
    error: { code, message: 'x', details: { rule, blockers } },
  });

  it('đọc blockers đúng dạng', () => {
    const b = [
      { userId: 'a', reasons: ['MISSING_HIRE_DATE', 'NEGATIVE_NET_PAY'] },
      { userId: 'b', reasons: ['MISSING_SALARY_PROFILE'] },
    ];
    expect(publishBlockers(res(422, body(b)))).toEqual(b);
  });

  it.each([
    ['status khác', res(409, body([]))],
    ['rule khác', res(422, body([], 'NEGATIVE_NET_PAY'))],
    [
      'không sắp theo userId',
      res(
        422,
        body([
          { userId: 'b', reasons: ['X'] },
          { userId: 'a', reasons: ['X'] },
        ]),
      ),
    ],
    ['reasons rỗng', res(422, body([{ userId: 'a', reasons: [] }]))],
  ])('%s ⇒ đỏ', (_, r) => {
    expect(() => publishBlockers(r)).toThrow();
  });
});
