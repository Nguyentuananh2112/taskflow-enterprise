import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatDateOnly, isOverdue, todayDateOnly } from './date-only';
import { LruSet } from './lru-set';
import { compareByRank, compareCodeUnits } from './rank';

describe('rank — so sánh code unit, khớp collation "C" (frontend.md §4.3)', () => {
  it('chữ hoa đứng trước chữ thường (khác localeCompare)', () => {
    expect(compareCodeUnits('Z', 'a')).toBeLessThan(0);
    expect('Z'.localeCompare('a', 'vi')).toBeGreaterThan(0); // lý do cấm localeCompare
  });

  it('sắp theo rank rồi id; rank trùng ⇒ id quyết định', () => {
    const items = [
      { id: 'b', rank: 'a1' },
      { id: 'a', rank: 'a1' },
      { id: 'c', rank: 'a0V' },
      { id: 'd', rank: 'Zz' },
    ];
    expect([...items].sort(compareByRank).map((i) => i.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('bằng nhau ⇒ 0', () => {
    expect(compareCodeUnits('a0', 'a0')).toBe(0);
  });
});

describe('date-only — không qua new Date("YYYY-MM-DD") (frontend.md §6.2)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hôm nay theo giờ địa phương', () => {
    expect(todayDateOnly(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(todayDateOnly(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('quá hạn khi hạn chót trước hôm nay; hôm nay chưa quá hạn; null không quá hạn', () => {
    const now = new Date(2026, 9, 15, 0, 30); // 00:30 sáng 15/10 giờ địa phương
    expect(isOverdue('2026-10-14', now)).toBe(true);
    expect(isOverdue('2026-10-15', now)).toBe(false);
    expect(isOverdue('2026-10-16', now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });

  it('định dạng dd/mm/yyyy', () => {
    expect(formatDateOnly('2026-10-05')).toBe('05/10/2026');
  });
});

describe('LruSet', () => {
  it('vượt capacity ⇒ bỏ phần tử cũ nhất', () => {
    const set = new LruSet<string>(2);
    set.add('a');
    set.add('b');
    set.add('c');
    expect([set.has('a'), set.has('b'), set.has('c')]).toEqual([false, true, true]);
    expect(set.size).toBe(2);
  });

  it('thêm lại phần tử ⇒ thành mới nhất', () => {
    const set = new LruSet<string>(2);
    set.add('a');
    set.add('b');
    set.add('a');
    set.add('c');
    expect([set.has('a'), set.has('b')]).toEqual([true, false]);
  });

  it('capacity < 1 ⇒ lỗi lập trình', () => {
    expect(() => new LruSet(0)).toThrow();
  });
});
