import { describe, expect, it } from 'vitest';

import type { CalendarDay, LeaveSpan } from './leave-days';
import {
  assertNotAfterLastDay,
  belongsToTenure,
  clipToTenure,
  countTenureHalfDays,
  offboardCleanupPlan,
} from './leave-tenure';

const span = (startDate: string, endDate = startDate, dayPart: LeaveSpan['dayPart'] = 'FULL') => ({
  startDate,
  endDate,
  dayPart,
});

/** T2–T7 làm, CN nghỉ (S0), không ngày lễ. */
function calendar(from: string, to: string): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    days.push({
      date: d.toISOString().slice(0, 10),
      isWorkday: d.getUTCDay() !== 0,
      isHoliday: false,
    });
  }
  return days;
}
const NOV = calendar('2026-11-01', '2026-11-30');
const errorOf = (fn: () => void): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
};

describe('assertNotAfterLastDay — AFTER_LAST_DAY (D H1)', () => {
  it('không có lịch nghỉ ⇒ không kiểm; kết thúc đúng lastDay ⇒ được; một ngày sau ⇒ 422 kèm lastDay', () => {
    expect(() => assertNotAfterLastDay(span('2026-12-30', '2026-12-31'), null)).not.toThrow();
    expect(() =>
      assertNotAfterLastDay(span('2026-11-23', '2026-11-25'), '2026-11-25'),
    ).not.toThrow();
    expect(
      errorOf(() => assertNotAfterLastDay(span('2026-11-23', '2026-11-26'), '2026-11-25')),
    ).toMatchObject({
      statusCode: 422,
      details: { rule: 'AFTER_LAST_DAY', lastDay: '2026-11-25' },
    });
    expect(() =>
      assertNotAfterLastDay(span('2026-11-26', '2026-11-26', 'AM'), '2026-11-25'),
    ).toThrow(expect.objectContaining({ statusCode: 422 }));
  });
});

describe('clipToTenure / countTenureHalfDays — đếm khi đọc, cắt theo nhiệm kỳ', () => {
  it('đơn vắt qua lastDay ⇒ chỉ phần ≤ lastDay; vắt qua ngày vào ⇒ chỉ phần ≥ from; nằm gọn ⇒ nguyên', () => {
    const leaving = { from: '2026-01-05', until: '2026-11-25' };
    expect(clipToTenure(span('2026-11-23', '2026-11-27'), leaving)).toEqual(
      span('2026-11-23', '2026-11-25'),
    );
    expect(countTenureHalfDays(span('2026-11-23', '2026-11-27'), NOV, leaving)).toBe(6); // T2–T4 = 3 ngày
    const rehired = { from: '2026-11-18', until: null };
    expect(clipToTenure(span('2026-11-16', '2026-11-19'), rehired)).toEqual(
      span('2026-11-18', '2026-11-19'),
    );
    expect(countTenureHalfDays(span('2026-11-16', '2026-11-19'), NOV, rehired)).toBe(4);
    expect(clipToTenure(span('2026-11-20', '2026-11-21'), rehired)).toEqual(
      span('2026-11-20', '2026-11-21'),
    );
  });

  it('ngoài hẳn nhiệm kỳ ⇒ null / 0; nửa ngày giữ phần AM/PM khi trong nhiệm kỳ', () => {
    const t = { from: '2026-11-10', until: '2026-11-20' };
    expect(clipToTenure(span('2026-11-02', '2026-11-07'), t)).toBeNull();
    expect(clipToTenure(span('2026-11-23'), t)).toBeNull();
    expect(countTenureHalfDays(span('2026-11-23'), NOV, t)).toBe(0);
    expect(clipToTenure(span('2026-11-20', '2026-11-20', 'PM'), t)).toEqual(
      span('2026-11-20', '2026-11-20', 'PM'),
    );
    expect(countTenureHalfDays(span('2026-11-20', '2026-11-20', 'PM'), NOV, t)).toBe(1);
  });
});

describe('belongsToTenure — nhận lại cùng năm (D H2)', () => {
  it('đơn bắt đầu trước ngày vào nhiệm kỳ hiện tại không thuộc nhiệm kỳ; từ ngày vào trở đi thì thuộc', () => {
    const current = { from: '2026-09-01', until: null };
    expect(belongsToTenure({ startDate: '2026-03-10' }, current)).toBe(false);
    expect(belongsToTenure({ startDate: '2026-08-31' }, current)).toBe(false);
    expect(belongsToTenure({ startDate: '2026-09-01' }, current)).toBe(true);
    const old = { from: '2026-01-05', until: '2026-03-31' };
    expect(belongsToTenure({ startDate: '2026-03-31' }, old)).toBe(true);
    expect(belongsToTenure({ startDate: '2026-04-01' }, old)).toBe(false);
  });
});

describe('offboardCleanupPlan — hành động hệ thống khi nghỉ việc (D H1)', () => {
  it('PENDING mọi ngày ⇒ CANCELLED; APPROVED bắt đầu sau lastDay ⇒ REVOKED (kể cả đã qua); vắt qua / trước giữ; trạng thái kết thúc bỏ qua', () => {
    const lastDay = '2026-11-25';
    const plan = offboardCleanupPlan(
      [
        { id: 'p-before', status: 'PENDING', startDate: '2026-11-02' },
        { id: 'p-after', status: 'PENDING', startDate: '2026-12-01' },
        { id: 'a-before', status: 'APPROVED', startDate: '2026-11-10' },
        { id: 'a-straddle', status: 'APPROVED', startDate: '2026-11-25' },
        { id: 'a-after', status: 'APPROVED', startDate: '2026-11-26' },
        { id: 'r', status: 'REJECTED', startDate: '2026-12-01' },
        { id: 'c', status: 'CANCELLED', startDate: '2026-12-01' },
        { id: 'v', status: 'REVOKED', startDate: '2026-12-01' },
      ],
      lastDay,
    );
    expect(plan).toEqual([
      { id: 'p-before', from: 'PENDING', to: 'CANCELLED' },
      { id: 'p-after', from: 'PENDING', to: 'CANCELLED' },
      { id: 'a-after', from: 'APPROVED', to: 'REVOKED' },
    ]);
  });

  it('không có đơn ⇒ kế hoạch rỗng', () => {
    expect(offboardCleanupPlan([], '2026-11-25')).toEqual([]);
  });
});
