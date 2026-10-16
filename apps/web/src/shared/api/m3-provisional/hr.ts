import { AttendanceDayDto, WorkShiftDto } from '@taskflow/contracts/attendance';
import { UserRefDto } from '@taskflow/contracts/auth';
import { DateOnly, IsoDateTime } from '@taskflow/contracts/common';
import * as z from 'zod';

// ⚠️ TẠM (T-041c): DTO chấm công phía HR theo chốt của A (T-038) qua tin nhắn 2026-10-16 tối —
// attendance-leave.md §5. Nghỉ phép phía HR đã là contracts thật (`@taskflow/contracts/leave`).
// KHI A đưa các schema này vào contracts attendance: xóa file, đổi import (P5).

/** A ✎: mỗi ngày mang múi giờ của lịch hiệu lực ngày đó (đổi lịch giữa tháng). */
export const HrDayDto = AttendanceDayDto.extend({ timezone: z.string().min(1) });
export type HrDayDto = z.infer<typeof HrDayDto>;

/** `GET attendance/today` (hr:manage) — không phân trang, sắp theo tên rồi id. */
export const CompanyTodayDto = z.object({
  serverNow: IsoDateTime,
  date: DateOnly,
  timezone: z.string().min(1),
  isWorkday: z.boolean(),
  isHoliday: z.boolean(),
  holidayName: z.string().nullable(),
  schedule: WorkShiftDto.nullable(),
  /** Nhân viên hiện tại (không VIEWER) + người đã rời có lượt chấm hôm đó (`left`). */
  members: z.array(z.object({ user: UserRefDto, left: z.boolean(), day: HrDayDto })),
});
export type CompanyTodayDto = z.infer<typeof CompanyTodayDto>;

/** Một người trong `GET attendance?month=` (phân trang 50, cursor). */
export const TimesheetRowDto = z.object({
  user: UserRefDto,
  left: z.boolean(),
  days: z.array(HrDayDto),
  totals: z.object({
    workedMin: z.int().min(0),
    lateDays: z.int().min(0),
    lateMin: z.int().min(0),
    earlyDays: z.int().min(0),
    earlyMin: z.int().min(0),
    /** Bước 0,5. */
    absentDays: z.number().min(0),
    leaveDays: z.number().min(0),
    missingOutDays: z.int().min(0),
  }),
});
export type TimesheetRowDto = z.infer<typeof TimesheetRowDto>;

/** Phiên bản lịch (ADR-121); danh sách rỗng = lịch mặc định T2–T7 08:00–17:30. */
export const WorkScheduleDto = WorkShiftDto.extend({
  effectiveFrom: DateOnly,
  timezone: z.string().min(1),
  /** Bitmask: bit 0 = thứ Hai … bit 6 = Chủ nhật. */
  workdays: z.int().min(1).max(127),
  createdBy: UserRefDto,
  createdAt: IsoDateTime,
});
export type WorkScheduleDto = z.infer<typeof WorkScheduleDto>;

const IANA_SHAPE = /^(UTC|[A-Z][A-Za-z_-]*(\/[A-Za-z0-9_+-]+){1,2})$/;
/**
 * Như `isSupportedTimeZone` của A (feat/T-038-attendance d25b8cf): KHÔNG dùng `Intl.supportedValuesOf` —
 * Node 24 thiếu `Asia/Ho_Chi_Minh` (chỉ có `Asia/Saigon`). Kiểm dạng IANA rồi thử `Intl.DateTimeFormat`.
 */
export const TimeZoneName = z
  .string()
  .max(64)
  .refine((tz) => {
    if (!IANA_SHAPE.test(tz)) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Múi giờ không hợp lệ (IANA, vd Asia/Ho_Chi_Minh).');

/** `POST attendance/schedules` — trùng `effectiveFrom` (hôm nay/tương lai) ⇒ thay phiên bản đó. */
export const CreateWorkScheduleBody = z
  .strictObject({
    effectiveFrom: DateOnly,
    timezone: TimeZoneName,
    workdays: z.int().min(1).max(127),
    startMin: z.int().min(0).max(1440),
    endMin: z.int().min(0).max(1440),
    breakStartMin: z.int().min(0).max(1440),
    breakEndMin: z.int().min(0).max(1440),
    graceMin: z.int().min(0).max(120),
  })
  .refine((b) => b.startMin < b.endMin, {
    path: ['endMin'],
    message: 'Giờ kết thúc phải sau giờ bắt đầu',
  })
  .refine(
    (b) =>
      b.startMin <= b.breakStartMin &&
      b.breakStartMin <= b.breakEndMin &&
      b.breakEndMin <= b.endMin,
    { path: ['breakEndMin'], message: 'Giờ nghỉ trưa phải nằm trong ca' },
  );
export type CreateWorkScheduleBody = z.infer<typeof CreateWorkScheduleBody>;

export const HolidayDto = z.object({ date: DateOnly, name: z.string() });
export type HolidayDto = z.infer<typeof HolidayDto>;

/** Ngày < hôm nay: chỉ OWNER, bắt buộc `reason` (422 HOLIDAY_IN_PAST / REASON_REQUIRED). */
const OptionalReason = z.string().trim().min(1).max(500).optional();
export const PutHolidayBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  reason: OptionalReason,
});
export type PutHolidayBody = z.infer<typeof PutHolidayBody>;
export const DeleteHolidayBody = z.strictObject({ reason: OptionalReason });
