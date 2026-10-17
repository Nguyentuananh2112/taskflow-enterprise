import { describe, expect, it } from 'vitest';

import { isWorkdayOn } from './workday';

const v = (effectiveFrom: string, workdays: number) => ({
  effectiveFrom,
  workdays,
  timezone: 'Asia/Ho_Chi_Minh',
  startMin: 480,
  endMin: 1050,
  breakStartMin: 720,
  breakEndMin: 810,
  graceMin: 0,
});

describe('isWorkdayOn (T-050 — lễ rơi CN/OFF)', () => {
  it('mặc định T2–T7: CN 18/10/2026 nghỉ, T7 17/10 làm', () => {
    expect(isWorkdayOn([], '2026-10-18')).toBe(false);
    expect(isWorkdayOn([], '2026-10-17')).toBe(true);
  });
  it('theo phiên bản hiệu lực của ngày đó (T2–T6 từ 01/10)', () => {
    const list = [v('2026-01-01', 0b0111111), v('2026-10-01', 0b0011111)];
    expect(isWorkdayOn(list, '2026-09-26')).toBe(true);
    expect(isWorkdayOn(list, '2026-10-17')).toBe(false);
  });
});
