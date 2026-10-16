import { describe, expect, it } from 'vitest';

import { BusinessRuleViolationError } from '../../../core/errors';
import {
  DEFAULT_ENTITLED_HALF_DAYS,
  assertBalanceCovers,
  consumesAnnualBalance,
  halfDaysFromDecimal,
  halfDaysToDecimal,
  summarizeBalance,
  type BalanceRequest,
} from './leave-balance';

const req = (
  id: string,
  status: BalanceRequest['status'],
  halfDays: number,
  type: BalanceRequest['type'] = 'ANNUAL',
) => ({
  id,
  status,
  halfDays,
  type,
});

describe('số dư phép (test-spec §4) — đơn vị nửa ngày', () => {
  it('LB-01: mặc định 12 ngày = 24 nửa ngày; chưa có đơn ⇒ còn 24', () => {
    expect(DEFAULT_ENTITLED_HALF_DAYS).toBe(24);
    expect(summarizeBalance({ entitled: 24, adjustment: 0, requests: [] })).toEqual({
      entitled: 24,
      adjustment: 0,
      used: 0,
      pending: 0,
      remaining: 24,
    });
  });

  it('LB-02: remaining = entitled + adjustment − used(APPROVED ANNUAL) − pending_khác; loại CHÍNH đơn đang xét', () => {
    const requests = [req('a', 'APPROVED', 4), req('b', 'PENDING', 6), req('me', 'PENDING', 3)];
    expect(summarizeBalance({ entitled: 24, adjustment: 2, requests }).remaining).toBe(
      24 + 2 - 4 - 6 - 3,
    );
    expect(
      summarizeBalance({ entitled: 24, adjustment: 2, requests, excludeId: 'me' }),
    ).toMatchObject({
      used: 4,
      pending: 6,
      remaining: 24 + 2 - 4 - 6,
    });
  });

  it('LB-03: SICK / UNPAID / OTHER / PERSONAL_PAID không trừ phép năm; đơn chết (REJECTED/CANCELLED/REVOKED) cũng không', () => {
    const requests = [
      req('s', 'APPROVED', 4, 'SICK'),
      req('u', 'PENDING', 4, 'UNPAID'),
      req('o', 'APPROVED', 2, 'OTHER'),
      req('p', 'APPROVED', 2, 'PERSONAL_PAID'),
      req('r', 'REJECTED', 4),
      req('c', 'CANCELLED', 4),
      req('v', 'REVOKED', 4),
    ];
    expect(summarizeBalance({ entitled: 24, adjustment: 0, requests })).toMatchObject({
      used: 0,
      pending: 0,
      remaining: 24,
    });
    expect(consumesAnnualBalance('ANNUAL')).toBe(true);
    for (const t of ['SICK', 'UNPAID', 'OTHER', 'PERSONAL_PAID'] as const)
      expect(consumesAnnualBalance(t)).toBe(false);
  });

  it('LB-08: adjustment âm làm remaining âm ⇒ vẫn trả số âm (hiển thị), đơn ANNUAL mới ⇒ 422 INSUFFICIENT_BALANCE', () => {
    const b = summarizeBalance({
      entitled: 24,
      adjustment: -20,
      requests: [req('a', 'APPROVED', 10)],
    });
    expect(b.remaining).toBe(-6);
    expect(() => assertBalanceCovers('ANNUAL', 1, b)).toThrow(BusinessRuleViolationError);
  });

  it('LV-06/12: thiếu ⇒ 422 rule INSUFFICIENT_BALANCE kèm số còn và số xin (ngày thập phân); vừa đủ ⇒ qua', () => {
    const b = summarizeBalance({
      entitled: 24,
      adjustment: 0,
      requests: [req('a', 'APPROVED', 20)],
    }); // còn 4
    expect(() => assertBalanceCovers('ANNUAL', 4, b)).not.toThrow();
    try {
      assertBalanceCovers('ANNUAL', 5, b);
      throw new Error('không ném');
    } catch (err) {
      expect(err).toBeInstanceOf(BusinessRuleViolationError);
      expect((err as BusinessRuleViolationError).details).toMatchObject({
        rule: 'INSUFFICIENT_BALANCE',
        remainingDays: 2,
        requestedDays: 2.5,
      });
    }
  });

  it('loại không trừ phép ⇒ không bao giờ thiếu, kể cả số dư âm', () => {
    const negative = summarizeBalance({ entitled: 0, adjustment: -10, requests: [] });
    expect(() => assertBalanceCovers('SICK', 40, negative)).not.toThrow();
    expect(() => assertBalanceCovers('UNPAID', 40, negative)).not.toThrow();
  });
});

describe('LB-09: biên Decimal(4,1) ↔ nửa ngày — không lệch làm tròn', () => {
  it('đọc chuỗi/số thập phân của Prisma ⇒ nửa ngày; ghi ngược lại ⇒ số thập phân', () => {
    expect(halfDaysFromDecimal('10.5')).toBe(21);
    expect(halfDaysFromDecimal('12')).toBe(24);
    expect(halfDaysFromDecimal('12.0')).toBe(24);
    expect(halfDaysFromDecimal(-3.5)).toBe(-7);
    expect(halfDaysFromDecimal('0')).toBe(0);
    expect(halfDaysToDecimal(21)).toBe(10.5);
    expect(halfDaysToDecimal(24)).toBe(12);
    expect(halfDaysToDecimal(-7)).toBe(-3.5);
    expect(halfDaysToDecimal(halfDaysFromDecimal('10.5'))).toBe(10.5);
  });

  it('0,1 + 0,2 kiểu số thực không xảy ra: cộng nửa ngày rồi mới đổi', () => {
    const sum =
      halfDaysFromDecimal('0.5') + halfDaysFromDecimal('0.5') + halfDaysFromDecimal('10.5');
    expect(halfDaysToDecimal(sum)).toBe(11.5);
  });

  it('giá trị không phải bội 0,5 (dữ liệu hỏng) ⇒ lỗi, không làm tròn âm thầm', () => {
    expect(() => halfDaysFromDecimal('10.3')).toThrow(/0,5/);
    expect(() => halfDaysFromDecimal('abc')).toThrow(/0,5/);
  });
});
