import { z } from 'zod';

import { DateOnly, IsoDateTime, Uuid } from '../common/primitives';

// Chấm công (T-038, thiết kế attendance-leave.md §4–§5, hợp đồng web chốt với E cho T-041a).
// Giờ trả về là ISO UTC; web hiển thị theo `timezone` của LỊCH hiệu lực (ADR-120), không theo máy.

/** Trạng thái ngày — thứ tự ưu tiên HOLIDAY > OFF > ON_LEAVE > PRESENT/MISSING_OUT > ABSENT > PENDING. */
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

/** Phần nghỉ đã duyệt của ngày (đơn APPROVED); `null` = không nghỉ. */
export const AttendanceLeavePart = z.enum(['FULL', 'AM', 'PM']);
export type AttendanceLeavePart = z.infer<typeof AttendanceLeavePart>;

/** Tháng `YYYY-MM` (query `?month=`). */
export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Tháng phải có dạng YYYY-MM.');
export type YearMonth = z.infer<typeof YearMonth>;

export const AttendanceMonthQuery = z.strictObject({ month: YearMonth });
export type AttendanceMonthQuery = z.infer<typeof AttendanceMonthQuery>;

/**
 * Header `Idempotency-Key` của check-in/out: UUID web sinh mỗi lần bấm, gửi lại CÙNG key khi tự thử lại
 * vì lỗi mạng. Duy nhất theo (workspace, user, nguồn) — lặp cùng user + cùng loại ⇒ 200 trả hôm nay hiện
 * tại; khác loại ⇒ 422.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IdempotencyKey = Uuid;

/** Mốc ca (phút kể từ 00:00 giờ của lịch). */
export const WorkShiftDto = z.object({
  startMin: z.int().min(0),
  endMin: z.int().min(0),
  breakStartMin: z.int().min(0),
  breakEndMin: z.int().min(0),
  graceMin: z.int().min(0),
});
export type WorkShiftDto = z.infer<typeof WorkShiftDto>;

const DayFlags = {
  status: DayStatus,
  late: z.boolean(),
  early: z.boolean(),
  absentHalf: z.boolean(),
  /** IN rồi, chưa OUT, chưa quá giờ kết thúc ⇒ thẻ "đang làm". */
  inProgress: z.boolean(),
  firstIn: IsoDateTime.nullable(),
  /** OUT sau 00:00 vẫn thuộc ngày trước (giờ chốt 06:00) ⇒ web hiển thị "00:30 (+1)". */
  lastOut: IsoDateTime.nullable(),
  leave: AttendanceLeavePart.nullable(),
};

/** `GET attendance/me/today` — cũng là body trả về của `POST attendance/check-in|check-out`. */
export const AttendanceTodayDto = z.object({
  /** Giờ server để web chạy đồng hồ theo độ lệch, không tin giờ máy. */
  serverNow: IsoDateTime,
  timezone: z.string().min(1),
  /** `workDate` theo múi giờ của lịch. */
  date: DateOnly,
  isWorkday: z.boolean(),
  isHoliday: z.boolean(),
  holidayName: z.string().nullable(),
  /** `null` khi chưa có lịch hiệu lực. */
  schedule: WorkShiftDto.nullable(),
  ...DayFlags,
});
export type AttendanceTodayDto = z.infer<typeof AttendanceTodayDto>;

/** Một ngày trong bảng công tháng. */
export const AttendanceDayDto = z.object({
  date: DateOnly,
  isWorkday: z.boolean(),
  holidayName: z.string().nullable(),
  workedMin: z.int().min(0),
  lateMin: z.int().min(0),
  earlyMin: z.int().min(0),
  ...DayFlags,
});
export type AttendanceDayDto = z.infer<typeof AttendanceDayDto>;

/** `GET attendance/me?month=` — `days` đủ mọi ngày của tháng (kể cả OFF / PENDING tương lai). */
export const AttendanceMonthDto = z.object({
  month: YearMonth,
  timezone: z.string().min(1),
  days: z.array(AttendanceDayDto),
});
export type AttendanceMonthDto = z.infer<typeof AttendanceMonthDto>;
