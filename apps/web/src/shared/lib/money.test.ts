import { describe, expect, it } from 'vitest';

import { MONEY_MAX, formatVnd, parseVnd, reformatVndInput, regroupTyped } from './money';

describe('tiền VND (T-050)', () => {
  it('formatVnd: dấu chấm nghìn + NBSP trước ₫', () => {
    expect(formatVnd(7_000_000)).toBe('7.000.000 ₫');
    expect(formatVnd(0)).toBe('0 ₫');
  });

  it('parseVnd: hiểu dán "7,000,000" / "7.000.000" / "7 000 000 ₫"; rỗng = 0', () => {
    for (const s of [
      '7000000',
      '7.000.000',
      '7,000,000',
      '7 000 000',
      '7.000.000 ₫',
      ' 7.000.000đ ',
    ]) {
      expect(parseVnd(s)).toBe(7_000_000);
    }
    expect(parseVnd('')).toBe(0);
  });

  it('parseVnd: số âm, chữ, phần lẻ, nhóm sai, vượt trần ⇒ null', () => {
    for (const s of ['-5', '5a', '7.5', '7.00.000', '1,2', String(MONEY_MAX + 1)]) {
      expect(parseVnd(s)).toBeNull();
    }
    expect(parseVnd(String(MONEY_MAX))).toBe(MONEY_MAX);
  });

  it('reformatVndInput: chèn dấu chấm khi hợp lệ, giữ nguyên khi chưa', () => {
    expect(reformatVndInput('7000000')).toBe('7.000.000');
    expect(reformatVndInput('7,000,000')).toBe('7.000.000');
    expect(reformatVndInput('7a')).toBe('7a');
    expect(reformatVndInput('')).toBe('');
  });

  it('regroupTyped: gõ tiếp sau số đã nhóm ⇒ nhóm lại; có chữ ⇒ giữ nguyên', () => {
    expect(regroupTyped('6.0000')).toBe('60.000');
    expect(regroupTyped('60.0000')).toBe('600.000');
    expect(regroupTyped('6.00')).toBe('600');
    expect(regroupTyped('6a')).toBe('6a');
  });
});
