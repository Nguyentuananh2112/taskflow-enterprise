import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type {
  AttendanceDayDto,
  AttendanceMemberMonthDto,
  AttendanceTotalsDto,
} from '@taskflow/contracts/attendance';

import { hrKeys } from '../model/query-keys';
import { replaceTimesheetDay } from './timesheet-cache';

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
  notCheckedInYet: false,
  firstIn: null,
  lastOut: null,
  leave: null,
  ...over,
});

const totals = (over: Partial<AttendanceTotalsDto> = {}): AttendanceTotalsDto => ({
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
  throughDate: '2026-10-31',
  ...over,
});

const row = (id: string, days: AttendanceDayDto[]): AttendanceMemberMonthDto => ({
  user: { id, fullName: id },
  left: false,
  days,
  totals: totals(),
});

describe('replaceTimesheetDay', () => {
  it('thay đúng 1 ô + dòng tổng (giá trị SERVER, web không tự cộng) của đúng người; người khác và ngày khác giữ nguyên tham chiếu', () => {
    const client = new QueryClient();
    const a = row('a', [day('2026-10-01'), day('2026-10-02')]);
    const b = row('b', [day('2026-10-01')]);
    const key = hrKeys.month('2026-10');
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
    const serverTotals = totals({ presentDays: 1, workedMin: 480, absentDays: 1 });
    replaceTimesheetDay(client, 'a', { day: fresh, totals: serverTotals });
    const pages = client.getQueryData<{ pages: Array<{ data: AttendanceMemberMonthDto[] }> }>(key);
    const [nextA, nextB] = pages?.pages[0]?.data ?? [];
    expect(nextA?.days[1]).toMatchObject({ status: 'PRESENT', timezone: 'Asia/Ho_Chi_Minh' });
    expect(nextA?.days[0]).toBe(a.days[0]);
    expect(nextA?.totals).toEqual(serverTotals);
    expect(nextB).toBe(b);
  });

  it('tháng khác chưa cache ⇒ không tạo dữ liệu', () => {
    const client = new QueryClient();
    replaceTimesheetDay(client, 'a', { day: day('2026-09-30'), totals: totals() });
    expect(client.getQueryData(hrKeys.month('2026-09'))).toBeUndefined();
  });
});
