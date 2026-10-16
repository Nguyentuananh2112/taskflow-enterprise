import { IsoDateTime } from '@taskflow/contracts/common';
import * as z from 'zod';

// ⚠️ TẠM (T-041a, 2026-10-16): DTO chấm công theo attendance-leave.md §5 "Hợp đồng cho web", đã thống
// nhất tên với A (T-038). Contracts thật chưa có hash ⇒ web mock trước bằng file này. KHI T-038 MERGE:
// xóa file, import từ `@taskflow/contracts/attendance` (P5 — FE không giữ bản sao DTO).

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Month = z.string().regex(/^\d{4}-\d{2}$/);

export const DayStatus = z.enum([
  'HOLIDAY',
  'OFF',
  'ON_LEAVE',
  'PRESENT',
  'MISSING_OUT',
  'ABSENT',
  'PENDING',
]);
export type DayStatus = z.infer<typeof DayStatus>;

export const LeaveDayPart = z.enum(['FULL', 'AM', 'PM']);
export type LeaveDayPart = z.infer<typeof LeaveDayPart>;

export const ScheduleDto = z.object({
  startMin: z.int(),
  endMin: z.int(),
  breakStartMin: z.int(),
  breakEndMin: z.int(),
  graceMin: z.int(),
});
export type ScheduleDto = z.infer<typeof ScheduleDto>;

/** `GET attendance/me/today` — cũng là body trả về của POST check-in / check-out. */
export const AttendanceTodayDto = z.object({
  serverNow: IsoDateTime,
  /** IANA, của phiên bản lịch đang hiệu lực (ADR-120). */
  timezone: z.string().min(1),
  /** workDate theo múi giờ của lịch. */
  date: DateOnly,
  isWorkday: z.boolean(),
  isHoliday: z.boolean(),
  holidayName: z.string().nullable(),
  schedule: ScheduleDto.nullable(),
  status: DayStatus,
  late: z.boolean(),
  early: z.boolean(),
  absentHalf: z.boolean(),
  /** Đã IN, chưa OUT, chưa quá giờ kết thúc. */
  inProgress: z.boolean(),
  firstIn: IsoDateTime.nullable(),
  lastOut: IsoDateTime.nullable(),
  leave: LeaveDayPart.nullable(),
});
export type AttendanceTodayDto = z.infer<typeof AttendanceTodayDto>;

export const AttendanceDayDto = z.object({
  date: DateOnly,
  isWorkday: z.boolean(),
  status: DayStatus,
  late: z.boolean(),
  early: z.boolean(),
  absentHalf: z.boolean(),
  firstIn: IsoDateTime.nullable(),
  lastOut: IsoDateTime.nullable(),
  workedMin: z.int().min(0),
  lateMin: z.int().min(0),
  earlyMin: z.int().min(0),
  leave: LeaveDayPart.nullable(),
  holidayName: z.string().nullable(),
});
export type AttendanceDayDto = z.infer<typeof AttendanceDayDto>;

/** `GET attendance/me?month=YYYY-MM` — đủ mọi ngày của tháng. */
export const AttendanceMonthDto = z.object({
  month: Month,
  timezone: z.string().min(1),
  days: z.array(AttendanceDayDto),
});
export type AttendanceMonthDto = z.infer<typeof AttendanceMonthDto>;

export const MonthQuery = z.object({ month: Month });
