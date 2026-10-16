import { describe, expect, it } from 'vitest';

import {
  AdjustAttendanceBody,
  AttendanceEventChangeDto,
  AttendanceEventsDto,
  AttendanceEventsQuery,
  AttendanceMonthDto,
  AttendanceMonthQuery,
  AttendanceTodayDto,
  IdempotencyKey,
  MyAttendanceEventsQuery,
  VoidAttendanceBody,
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
    const { serverNow: _s, isHoliday: _h, schedule: _sc, timezone: _tz, ...day } = today;
    const row = { ...day, holidayName: null, workedMin: 480, lateMin: 0, earlyMin: 0 };
    const month = { month: '2026-11', timezone: 'Asia/Ho_Chi_Minh', days: [row] };
    expect(AttendanceMonthDto.parse(month)).toEqual(month);
    expect(
      AttendanceMonthDto.safeParse({ ...month, days: [{ ...row, workedMin: -1 }] }).success,
    ).toBe(false);
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
    const { serverNow: _s, isHoliday: _h, schedule: _sc, timezone: _tz, ...day } = today;
    const row = { ...day, holidayName: null, workedMin: 0, lateMin: 0, earlyMin: 0 };
    const change = { event, day: row };
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
});
