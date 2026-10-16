import { describe, expect, it } from 'vitest';

import { BusinessRuleViolationError, ValidationError } from '../../../core/errors';
import {
  assertLeaveRange,
  countLeaveHalfDays,
  occupiedSlots,
  overlaps,
  type CalendarDay,
  type LeaveSpan,
} from './leave-days';

// S0 (test-spec-hr §0.2): T2–T7 là ngày làm, CN nghỉ. 2026-11-16 là thứ Hai.
const WEEKDAY = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = CN
function calendar(
  from: string,
  to: string,
  holidays: string[] = [],
  offFrom?: { date: string; offDays: number[] },
) {
  const days: CalendarDay[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const date = d.toISOString().slice(0, 10);
    const off = offFrom && date >= offFrom.date ? offFrom.offDays : [0];
    days.push({
      date,
      isWorkday: !off.includes(WEEKDAY(date)),
      isHoliday: holidays.includes(date),
    });
  }
  return days;
}
const span = (
  startDate: string,
  endDate: string,
  dayPart: LeaveSpan['dayPart'] = 'FULL',
): LeaveSpan => ({
  startDate,
  endDate,
  dayPart,
});

describe('countLeaveHalfDays (test-spec-hr §2 — đơn vị nửa ngày)', () => {
  it('LD-01: T2 16/11 FULL ⇒ 2 (1,0 ngày)', () => {
    expect(
      countLeaveHalfDays(span('2026-11-16', '2026-11-16'), calendar('2026-11-16', '2026-11-16')),
    ).toBe(2);
  });

  it('LD-02: T2 AM ⇒ 1 (0,5 ngày); PM cũng 1', () => {
    const cal = calendar('2026-11-16', '2026-11-16');
    expect(countLeaveHalfDays(span('2026-11-16', '2026-11-16', 'AM'), cal)).toBe(1);
    expect(countLeaveHalfDays(span('2026-11-16', '2026-11-16', 'PM'), cal)).toBe(1);
  });

  it('LD-03: 16/11 → 21/11 (T2–T7) ⇒ 12 (6 ngày)', () => {
    expect(
      countLeaveHalfDays(span('2026-11-16', '2026-11-21'), calendar('2026-11-16', '2026-11-21')),
    ).toBe(12);
  });

  it('LD-04: 14/11 → 16/11 (T7–T2) ⇒ 4 (CN không tính)', () => {
    expect(
      countLeaveHalfDays(span('2026-11-14', '2026-11-16'), calendar('2026-11-14', '2026-11-16')),
    ).toBe(4);
  });

  it('LD-05: như LD-03 + lễ 18/11 ⇒ 10', () => {
    const cal = calendar('2026-11-16', '2026-11-21', ['2026-11-18']);
    expect(countLeaveHalfDays(span('2026-11-16', '2026-11-21'), cal)).toBe(10);
  });

  it('LD-06: CN 15/11 FULL ⇒ 0; AM ngày lễ ⇒ 0', () => {
    expect(
      countLeaveHalfDays(span('2026-11-15', '2026-11-15'), calendar('2026-11-15', '2026-11-15')),
    ).toBe(0);
    const holiday = calendar('2026-11-16', '2026-11-16', ['2026-11-16']);
    expect(countLeaveHalfDays(span('2026-11-16', '2026-11-16', 'AM'), holiday)).toBe(0);
  });

  it('LD-09: thêm lễ sau khi đã duyệt ⇒ đọc lại giảm 2 (tính khi đọc, không lưu)', () => {
    const s = span('2026-11-16', '2026-11-21');
    const before = countLeaveHalfDays(s, calendar('2026-11-16', '2026-11-21'));
    const after = countLeaveHalfDays(s, calendar('2026-11-16', '2026-11-21', ['2026-11-18']));
    expect(before - after).toBe(2);
  });

  it('LD-10: đổi lịch giữa khoảng (S1 từ 18/11 bỏ thứ 7) ⇒ mỗi ngày theo lịch hiệu lực của nó', () => {
    // 14/11 (T7, S0: làm) → 21/11 (T7, S1: nghỉ): 14 + 16,17 (S0) + 18,19,20 (S1) = 6 ngày; CN 15 và T7 21 nghỉ.
    const cal = calendar('2026-11-14', '2026-11-21', [], { date: '2026-11-18', offDays: [0, 6] });
    expect(countLeaveHalfDays(span('2026-11-14', '2026-11-21'), cal)).toBe(12);
  });

  it('lịch thiếu ngày trong khoảng ⇒ lỗi lập trình (không đoán là ngày nghỉ)', () => {
    const cal = calendar('2026-11-16', '2026-11-16'); // thiếu 17/11
    expect(() => countLeaveHalfDays(span('2026-11-16', '2026-11-17'), cal)).toThrow(/17/);
  });

  it('lịch có thêm ngày NGOÀI khoảng ⇒ bỏ qua (chỉ đếm trong [start, end])', () => {
    const cal = calendar('2026-11-14', '2026-11-21');
    expect(countLeaveHalfDays(span('2026-11-16', '2026-11-16'), cal)).toBe(2);
  });
});

describe('assertLeaveRange', () => {
  it('LD-07: dayPart ≠ FULL với start ≠ end ⇒ ValidationError (field dayPart)', () => {
    expect(() => assertLeaveRange(span('2026-11-16', '2026-11-17', 'AM'))).toThrow(ValidationError);
    try {
      assertLeaveRange(span('2026-11-16', '2026-11-17', 'PM'));
    } catch (err) {
      expect((err as ValidationError).details).toMatchObject({
        issues: [expect.objectContaining({ path: ['dayPart'] })],
      });
    }
  });

  it('endDate < startDate ⇒ ValidationError (field endDate)', () => {
    expect(() => assertLeaveRange(span('2026-11-17', '2026-11-16'))).toThrow(ValidationError);
    try {
      assertLeaveRange(span('2026-11-17', '2026-11-16'));
    } catch (err) {
      expect((err as ValidationError).details).toMatchObject({
        issues: [expect.objectContaining({ path: ['endDate'] })],
      });
    }
  });

  it('LD-08: vắt 2 năm (30/12/2026 → 02/01/2027) ⇒ 422 rule spans_two_years', () => {
    expect(() => assertLeaveRange(span('2026-12-30', '2027-01-02'))).toThrow(
      BusinessRuleViolationError,
    );
    try {
      assertLeaveRange(span('2026-12-30', '2027-01-02'));
    } catch (err) {
      expect((err as BusinessRuleViolationError).details).toMatchObject({
        rule: 'spans_two_years',
      });
    }
  });

  it('hợp lệ: cùng ngày AM; khoảng nhiều ngày FULL; 31/12 một ngày', () => {
    expect(() => assertLeaveRange(span('2026-11-16', '2026-11-16', 'AM'))).not.toThrow();
    expect(() => assertLeaveRange(span('2026-11-16', '2026-11-21'))).not.toThrow();
    expect(() => assertLeaveRange(span('2026-12-31', '2026-12-31'))).not.toThrow();
  });
});

describe('overlaps (D-M2: chồng theo ngày + phần)', () => {
  it('LV-03: AM ‖ PM cùng ngày ⇒ không chồng', () => {
    expect(
      overlaps(span('2026-11-16', '2026-11-16', 'AM'), span('2026-11-16', '2026-11-16', 'PM')),
    ).toBe(false);
  });

  it('LV-04: AM ‖ FULL cùng ngày ⇒ chồng; PM ‖ FULL ⇒ chồng; AM ‖ AM ⇒ chồng', () => {
    expect(overlaps(span('2026-11-16', '2026-11-16', 'AM'), span('2026-11-16', '2026-11-16'))).toBe(
      true,
    );
    expect(overlaps(span('2026-11-16', '2026-11-16'), span('2026-11-16', '2026-11-16', 'PM'))).toBe(
      true,
    );
    expect(
      overlaps(span('2026-11-16', '2026-11-16', 'AM'), span('2026-11-16', '2026-11-16', 'AM')),
    ).toBe(true);
  });

  it('LV-02: khoảng chồng một phần; chạm biên đúng 1 ngày ⇒ chồng; liền kề ⇒ không', () => {
    expect(overlaps(span('2026-11-16', '2026-11-18'), span('2026-11-18', '2026-11-20'))).toBe(true);
    expect(overlaps(span('2026-11-16', '2026-11-20'), span('2026-11-17', '2026-11-17', 'PM'))).toBe(
      true,
    );
    expect(overlaps(span('2026-11-16', '2026-11-17'), span('2026-11-18', '2026-11-19'))).toBe(
      false,
    );
    expect(overlaps(span('2026-11-18', '2026-11-19'), span('2026-11-16', '2026-11-17'))).toBe(
      false,
    );
  });

  it('occupiedSlots: FULL nhiều ngày ⇒ AM + PM mỗi ngày (kể cả ngày nghỉ — chồng tính theo lịch biểu đơn, không theo lịch làm)', () => {
    expect(occupiedSlots(span('2026-11-16', '2026-11-17'))).toEqual([
      '2026-11-16:AM',
      '2026-11-16:PM',
      '2026-11-17:AM',
      '2026-11-17:PM',
    ]);
    expect(occupiedSlots(span('2026-11-16', '2026-11-16', 'PM'))).toEqual(['2026-11-16:PM']);
  });
});
