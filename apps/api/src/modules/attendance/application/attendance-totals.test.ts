import { AttendanceTotalsDto, type AttendanceDayDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { totalsOf } from './attendance-totals';

// T-046 (TL d9 chốt 4 điểm): tổng tháng dùng CHUNG cho me?month và bảng HR. Chỉ đếm ngày ≤ hôm nay ở mọi cột;
// phép đã duyệt sau hôm nay ⇒ `upcomingLeaveDays`; `workedMin` chỉ có ở ngày đã có OUT (summarizeDay).

const base: AttendanceDayDto = {
  date: '2026-11-02',
  timezone: 'Asia/Ho_Chi_Minh',
  isWorkday: true,
  holidayName: null,
  workedMin: 0,
  lateMin: 0,
  earlyMin: 0,
  status: 'PENDING',
  late: false,
  early: false,
  absentHalf: false,
  inProgress: false,
  notCheckedInYet: false,
  firstIn: null,
  lastOut: null,
  leave: null,
};
const day = (date: string, over: Partial<AttendanceDayDto> = {}): AttendanceDayDto => ({
  ...base,
  date,
  ...over,
});
const present = (date: string, over: Partial<AttendanceDayDto> = {}) =>
  day(date, { status: 'PRESENT', workedMin: 480, firstIn: `${date}T01:00:00.000Z`, ...over });

const ZERO = {
  workedMin: 0,
  lateDays: 0,
  lateMin: 0,
  earlyDays: 0,
  earlyMin: 0,
  absentDays: 0,
  leaveDays: 0,
  missingOutDays: 0,
  presentDays: 0,
  upcomingLeaveDays: 0,
};

describe('totalsOf', () => {
  it('ngày đi làm = PRESENT + MISSING_OUT; vắng 0,5 khi nghỉ nửa ngày + vắng nửa kia; NOT_EMPLOYED / HOLIDAY / OFF = 0', () => {
    const t = totalsOf(
      [
        present('2026-11-02', { late: true, lateMin: 10, workedMin: 470 }),
        day('2026-11-03', { status: 'MISSING_OUT', firstIn: '2026-11-03T01:00:00.000Z' }),
        day('2026-11-04', { status: 'ABSENT' }),
        day('2026-11-05', { status: 'ABSENT', absentHalf: true, leave: 'AM' }),
        present('2026-11-06', { leave: 'PM', workedMin: 210 }),
        day('2026-11-07', { status: 'ON_LEAVE', leave: 'FULL' }),
        day('2026-11-08', { status: 'OFF', isWorkday: false }),
        day('2026-11-09', { status: 'HOLIDAY', holidayName: 'Lễ', leave: 'FULL' }),
        day('2026-11-10', { status: 'NOT_EMPLOYED' }),
      ],
      '2026-11-30',
    );
    expect(AttendanceTotalsDto.parse(t)).toEqual(t);
    expect(t).toEqual({
      ...ZERO,
      workedMin: 680,
      lateDays: 1,
      lateMin: 10,
      absentDays: 1.5,
      leaveDays: 2, // AM 0,5 + PM 0,5 + FULL 1 (lễ trùng phép = 0)
      missingOutDays: 1,
      presentDays: 3, // 02 + 03 (thiếu giờ ra) + 06 (nghỉ chiều, đi làm sáng)
      throughDate: '2026-11-10',
    });
  });

  it('chỉ đếm ngày ≤ hôm nay ở MỌI cột; phép đã duyệt sau hôm nay ⇒ upcomingLeaveDays (FULL 1, nửa ngày 0,5)', () => {
    const t = totalsOf(
      [
        present('2026-11-16'),
        day('2026-11-17', { status: 'PRESENT', late: true, lateMin: 5, inProgress: true }), // hôm nay, đang làm
        day('2026-11-18', { status: 'ON_LEAVE', leave: 'FULL' }),
        day('2026-11-19', { leave: 'AM' }),
        day('2026-11-20'),
        day('2026-11-21', { status: 'HOLIDAY', holidayName: 'Lễ', leave: 'FULL' }), // lễ ⇒ không trừ phép
        day('2026-11-22', { status: 'OFF', isWorkday: false, leave: 'FULL' }),
        // Ngày tương lai không bao giờ có số thật, nhưng nếu có (dữ liệu lệch) cũng KHÔNG cộng.
        day('2026-11-23', { status: 'ABSENT', workedMin: 99, late: true, lateMin: 9 }),
      ],
      '2026-11-17',
    );
    expect(t).toEqual({
      ...ZERO,
      workedMin: 480, // hôm nay chưa OUT ⇒ 0 (summarizeDay), không cộng phần đang làm
      lateDays: 1, // hôm nay vào muộn đã biết ⇒ tính
      lateMin: 5,
      presentDays: 2,
      upcomingLeaveDays: 1.5,
      throughDate: '2026-11-17',
    });
  });

  it('throughDate: tháng đã qua ⇒ ngày cuối; tháng chưa tới ⇒ null và mọi cột 0 (trừ phép sắp tới)', () => {
    expect(
      totalsOf([day('2026-10-30'), day('2026-10-31', { status: 'ABSENT' })], '2026-11-17'),
    ).toMatchObject({
      throughDate: '2026-10-31',
      absentDays: 1,
    });
    expect(
      totalsOf(
        [day('2026-12-01', { status: 'ON_LEAVE', leave: 'FULL' }), day('2026-12-02')],
        '2026-11-17',
      ),
    ).toEqual({ ...ZERO, upcomingLeaveDays: 1, throughDate: null });
    expect(totalsOf([], '2026-11-17')).toEqual({ ...ZERO, throughDate: null });
  });
});
