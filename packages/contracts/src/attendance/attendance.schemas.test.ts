import { describe, expect, it } from 'vitest';

import {
  AdjustAttendanceBody,
  AttendanceEventChangeDto,
  AttendanceEventsDto,
  AttendanceEventsQuery,
  AttendanceMonthDto,
  AttendanceMonthQuery,
  AttendanceTodayDto,
  CreateWorkScheduleBody,
  DayStatus,
  DeleteHolidayBody,
  HolidayListQuery,
  IdempotencyKey,
  MyAttendanceEventsQuery,
  PutHolidayBody,
  VoidAttendanceBody,
  WorkScheduleDto,
} from './attendance.schemas';

// Hợp đồng web T-041a (E) ↔ T-038 (A): ví dụ đầy đủ phải qua schema; giá trị sai phải bị từ chối.
const today = {
  serverNow: '2026-11-17T03:00:00.000Z',
  timezone: 'Asia/Ho_Chi_Minh',
  date: '2026-11-17',
  isWorkday: true,
  isHoliday: false,
  holidayName: null,
  schedule: { startMin: 480, endMin: 1050, breakStartMin: 720, breakEndMin: 810, graceMin: 0 },
  status: 'PRESENT',
  late: false,
  early: false,
  absentHalf: false,
  inProgress: true,
  firstIn: '2026-11-17T00:55:00.000Z',
  lastOut: null,
  leave: null,
};

describe('attendance contracts', () => {
  it('AttendanceTodayDto: ví dụ thẻ "đang làm" hợp lệ; lịch null hợp lệ; status lạ bị từ chối', () => {
    expect(AttendanceTodayDto.parse(today)).toEqual(today);
    expect(AttendanceTodayDto.safeParse({ ...today, schedule: null }).success).toBe(true);
    expect(AttendanceTodayDto.safeParse({ ...today, status: 'LATE' }).success).toBe(false);
    expect(AttendanceTodayDto.safeParse({ ...today, leave: 'HALF' }).success).toBe(false);
  });

  it('AttendanceMonthDto: ngày có phút làm; phút âm bị từ chối', () => {
    const { serverNow: _s, isHoliday: _h, schedule: _sc, ...day } = today;
    const row = { ...day, holidayName: null, workedMin: 480, lateMin: 0, earlyMin: 0 };
    const totals = {
      workedMin: 480,
      lateDays: 0,
      lateMin: 0,
      earlyDays: 0,
      earlyMin: 0,
      absentDays: 0.5,
      leaveDays: 1.5,
      missingOutDays: 0,
      presentDays: 1,
      upcomingLeaveDays: 1,
      throughDate: '2026-11-17',
    };
    const month = { month: '2026-11', timezone: 'Asia/Ho_Chi_Minh', days: [row], totals };
    expect(AttendanceMonthDto.parse(month)).toEqual(month);
    expect(
      AttendanceMonthDto.safeParse({ ...month, days: [{ ...row, workedMin: -1 }] }).success,
    ).toBe(false);
    // T-046: tháng chưa tới ⇒ throughDate null; bước 0,5 bắt buộc cho phép sắp tới; thiếu totals ⇒ sai hợp đồng.
    expect(
      AttendanceMonthDto.safeParse({ ...month, totals: { ...totals, throughDate: null } }).success,
    ).toBe(true);
    expect(
      AttendanceMonthDto.safeParse({ ...month, totals: { ...totals, upcomingLeaveDays: 0.3 } })
        .success,
    ).toBe(false);
    const { totals: _t, ...withoutTotals } = month;
    expect(AttendanceMonthDto.safeParse(withoutTotals).success).toBe(false);
  });

  it('AttendanceMonthQuery: chỉ YYYY-MM tháng 01–12, không nhận khóa lạ', () => {
    expect(AttendanceMonthQuery.parse({ month: '2026-11' })).toEqual({ month: '2026-11' });
    for (const month of ['2026-13', '2026-00', '2026-1', '26-11', '2026-11-01']) {
      expect(AttendanceMonthQuery.safeParse({ month }).success, month).toBe(false);
    }
    expect(AttendanceMonthQuery.safeParse({ month: '2026-11', user: 'x' }).success).toBe(false);
  });

  it('IdempotencyKey: bắt buộc UUID', () => {
    expect(IdempotencyKey.safeParse('0199e5a2-0000-7000-8000-000000000001').success).toBe(true);
    expect(IdempotencyKey.safeParse('abc').success).toBe(false);
  });

  const MIA = '0199e5a2-0000-7000-8000-0000000000b1';
  const event = {
    id: '0199e5a2-0000-7000-8000-000000000101',
    userId: MIA,
    kind: 'IN',
    source: 'WEB',
    occurredAt: '2026-11-17T00:55:00.000Z',
    workDate: '2026-11-17',
    note: null,
    createdBy: { id: MIA, fullName: 'Mia' },
    voidedAt: '2026-11-17T03:00:00.000Z',
    voidedBy: { id: '0199e5a2-0000-7000-8000-0000000000c1', fullName: 'Hana' },
    voidReason: 'Bấm nhầm',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
  };

  it('AttendanceEventsDto: lượt đã hủy kèm người hủy + lý do; source/kind lạ bị từ chối', () => {
    const dto = { timezone: 'Asia/Ho_Chi_Minh', events: [event] };
    expect(AttendanceEventsDto.parse(dto)).toEqual(dto);
    expect(
      AttendanceEventsDto.safeParse({ ...dto, events: [{ ...event, source: 'API' }] }).success,
    ).toBe(false);
    expect(
      AttendanceEventsDto.safeParse({ ...dto, events: [{ ...event, kind: 'BREAK' }] }).success,
    ).toBe(false);
  });

  it('AttendanceEventChangeDto: { event, day }', () => {
    const { serverNow: _s, isHoliday: _h, schedule: _sc, ...day } = today;
    const row = { ...day, holidayName: null, workedMin: 0, lateMin: 0, earlyMin: 0 };
    const change = {
      event,
      day: row,
      totals: {
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
        throughDate: '2026-11-17',
      },
    };
    expect(AttendanceEventChangeDto.parse(change)).toEqual(change);
  });

  it('query lượt: HR cần userId + date; nhân viên chỉ date; không nhận khóa lạ', () => {
    expect(AttendanceEventsQuery.safeParse({ userId: MIA, date: '2026-11-17' }).success).toBe(true);
    expect(AttendanceEventsQuery.safeParse({ date: '2026-11-17' }).success).toBe(false);
    expect(MyAttendanceEventsQuery.safeParse({ date: '2026-11-17' }).success).toBe(true);
    expect(MyAttendanceEventsQuery.safeParse({ date: '2026-11-17', userId: MIA }).success).toBe(
      false,
    );
  });

  it('AdjustAttendanceBody: giờ HH:mm 00:00–23:59, nextDay mặc định false, lý do bắt buộc (trim, ≤ 500)', () => {
    const body = {
      userId: MIA,
      kind: 'OUT',
      date: '2026-11-16',
      time: '00:30',
      nextDay: true,
      reason: 'Quên chấm ra',
    };
    expect(AdjustAttendanceBody.parse(body)).toEqual(body);
    const { nextDay: _n, ...noFlag } = body;
    expect(AdjustAttendanceBody.parse(noFlag).nextDay).toBe(false);
    for (const time of ['24:00', '7:30', '07:60', '0730']) {
      expect(AdjustAttendanceBody.safeParse({ ...body, time }).success, time).toBe(false);
    }
    for (const reason of ['', '   ', 'x'.repeat(501)]) {
      expect(AdjustAttendanceBody.safeParse({ ...body, reason }).success).toBe(false);
      expect(VoidAttendanceBody.safeParse({ reason }).success).toBe(false);
    }
    expect(
      AdjustAttendanceBody.safeParse({ ...body, occurredAt: '2026-11-16T00:00:00Z' }).success,
    ).toBe(false);
  });

  it('DayStatus: RETENTION_EXPIRED (T-047) rồi NOT_EMPLOYED đứng đầu thứ tự ưu tiên', () => {
    expect(DayStatus.options.slice(0, 2)).toEqual(['RETENTION_EXPIRED', 'NOT_EMPLOYED']);
  });

  it('CreateWorkScheduleBody: AT-19 múi giờ lạ ⇒ từ chối; ca / giờ nghỉ / workdays / grace trong miền', () => {
    const s0 = {
      effectiveFrom: '2026-11-17',
      timezone: 'Asia/Ho_Chi_Minh',
      workdays: 0b0111111,
      startMin: 480,
      endMin: 1050,
      breakStartMin: 720,
      breakEndMin: 810,
      graceMin: 0,
    };
    expect(CreateWorkScheduleBody.parse(s0)).toEqual(s0);
    for (const timezone of [
      'UTC',
      'Europe/Berlin',
      'America/New_York',
      'Asia/Kolkata',
      'Etc/GMT+7',
    ]) {
      expect(CreateWorkScheduleBody.safeParse({ ...s0, timezone }).success).toBe(true);
    }
    for (const bad of [
      { timezone: 'Mars/Base' },
      { timezone: '' },
      // `Intl.DateTimeFormat` nhận các dạng này, nhưng chúng không phải tên IANA.
      { timezone: '+07:00' },
      { timezone: 'utc' },
      { timezone: 'EST' },
      { workdays: 0 },
      { workdays: 128 },
      { startMin: 1050, endMin: 1050 },
      { endMin: 1441 },
      { breakStartMin: 470 },
      { breakEndMin: 1060 },
      { breakStartMin: 810, breakEndMin: 720 },
      { graceMin: -1 },
      { graceMin: 121 },
      { startMin: 480.5 },
      { createdBy: 'x' },
    ]) {
      expect(CreateWorkScheduleBody.safeParse({ ...s0, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
    // Không nghỉ trưa: breakStart = breakEnd.
    expect(
      CreateWorkScheduleBody.safeParse({ ...s0, breakStartMin: 720, breakEndMin: 720 }).success,
    ).toBe(true);
    const dto = {
      ...s0,
      createdBy: { id: '0199e5a2-0000-7000-8000-000000000001', fullName: 'Hana' },
      createdAt: '2026-11-17T03:00:00.000Z',
    };
    expect(WorkScheduleDto.parse(dto)).toEqual(dto);
  });

  it('ngày lễ: tên trim 1–100, lý do tùy chọn (trim 1–500); năm 2000–2100; không nhận khóa lạ', () => {
    expect(PutHolidayBody.parse({ name: '  Quốc khánh ' })).toEqual({ name: 'Quốc khánh' });
    expect(PutHolidayBody.safeParse({ name: 'x', reason: 'Nhập bù' }).success).toBe(true);
    for (const bad of [
      { name: '  ' },
      { name: 'x'.repeat(101) },
      { name: 'x', reason: ' ' },
      { name: 'x', date: '2026-01-01' },
    ]) {
      expect(PutHolidayBody.safeParse(bad).success).toBe(false);
    }
    expect(DeleteHolidayBody.safeParse({}).success).toBe(true);
    expect(DeleteHolidayBody.safeParse({ reason: '' }).success).toBe(false);
    expect(HolidayListQuery.parse({ year: '2026' })).toEqual({ year: 2026 });
    for (const year of ['1999', '2101', '20x6', '2026.5']) {
      expect(HolidayListQuery.safeParse({ year }).success).toBe(false);
    }
  });
});
