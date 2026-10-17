import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { AttendanceDayDto, AttendanceMemberMonthDto } from '@taskflow/contracts/attendance';

import { hrKeys } from '../model/query-keys';
import { replaceTimesheetDay, totalsOf } from './timesheet-cache';

const day = (date: string, over: Partial<AttendanceDayDto> = {}): AttendanceDayDto => ({
  date,
  timezone: 'Asia/Ho_Chi_Minh',
  isWorkday: true,
  holidayName: null,
  workedMin: 0,
  lateMin: 0,
  earlyMin: 0,
  status: 'ABSENT',
  late: false,
  early: false,
  absentHalf: false,
  inProgress: false,
  firstIn: null,
  lastOut: null,
  leave: null,
  ...over,
});

const row = (id: string, days: AttendanceDayDto[]): AttendanceMemberMonthDto => ({
  user: { id, fullName: id },
  left: false,
  days,
  totals: totalsOf(days, '2026-10-31'),
});

describe('totalsOf', () => {
  it('vắng nửa ngày = 0,5; nghỉ AM/PM = 0,5; muộn/sớm đếm lần + phút; quên chấm ra', () => {
    const t = totalsOf(
      [
        day('2026-10-01', { status: 'PRESENT', workedMin: 450, late: true, lateMin: 10 }),
        day('2026-10-02', { status: 'ABSENT', absentHalf: true, leave: 'AM' }),
        day('2026-10-03', { status: 'ON_LEAVE', leave: 'FULL' }),
        day('2026-10-05', { status: 'PRESENT', workedMin: 400, early: true, earlyMin: 30 }),
        day('2026-10-06', { status: 'MISSING_OUT' }),
        day('2026-10-07'),
        day('2026-10-04', { status: 'OFF', isWorkday: false }),
      ],
      '2026-10-31',
    );
    expect(t).toEqual({
      workedMin: 850,
      lateDays: 1,
      lateMin: 10,
      earlyDays: 1,
      earlyMin: 30,
      absentDays: 1.5,
      leaveDays: 1.5,
      missingOutDays: 1,
      presentDays: 3,
      upcomingLeaveDays: 0,
      throughDate: '2026-10-04',
    });
  });

  it('T-046: chỉ đếm tới mốc (throughDate cũ); phép sau mốc ⇒ upcomingLeaveDays; tháng chưa tới (null) ⇒ chỉ phép sắp tới', () => {
    const days = [
      day('2026-10-05', { status: 'ABSENT' }),
      day('2026-10-06', { status: 'ON_LEAVE', leave: 'FULL' }),
      day('2026-10-07', { leave: 'PM' }),
    ];
    expect(totalsOf(days, '2026-10-05')).toMatchObject({
      absentDays: 1,
      leaveDays: 0,
      upcomingLeaveDays: 1.5,
      throughDate: '2026-10-05',
    });
    expect(totalsOf(days, null)).toMatchObject({
      absentDays: 0,
      upcomingLeaveDays: 1.5,
      throughDate: null,
    });
  });
});

describe('replaceTimesheetDay', () => {
  it('thay đúng 1 ô của đúng người + tính lại tổng; người khác và ngày khác giữ nguyên tham chiếu', () => {
    const client = new QueryClient();
    const a = row('a', [day('2026-10-01'), day('2026-10-02')]);
    const b = row('b', [day('2026-10-01')]);
    const key = hrKeys.month('ws', '2026-10');
    client.setQueryData(key, {
      pages: [{ data: [a, b], page: undefined, requestId: undefined }],
      pageParams: [undefined],
    });
    const fresh = day('2026-10-02', {
      status: 'PRESENT',
      workedMin: 480,
      firstIn: '2026-10-02T01:00:00.000Z',
      lastOut: '2026-10-02T10:30:00.000Z',
    });
    replaceTimesheetDay(client, 'ws', 'a', fresh);
    const pages = client.getQueryData<{ pages: Array<{ data: AttendanceMemberMonthDto[] }> }>(key);
    const [nextA, nextB] = pages?.pages[0]?.data ?? [];
    expect(nextA?.days[1]).toMatchObject({ status: 'PRESENT', timezone: 'Asia/Ho_Chi_Minh' });
    expect(nextA?.days[0]).toBe(a.days[0]);
    expect(nextA?.totals.absentDays).toBe(1);
    expect(nextA?.totals.workedMin).toBe(480);
    expect(nextB).toBe(b);
  });

  it('tháng khác chưa cache ⇒ không tạo dữ liệu', () => {
    const client = new QueryClient();
    replaceTimesheetDay(client, 'ws', 'a', day('2026-09-30'));
    expect(client.getQueryData(hrKeys.month('ws', '2026-09'))).toBeUndefined();
  });
});
