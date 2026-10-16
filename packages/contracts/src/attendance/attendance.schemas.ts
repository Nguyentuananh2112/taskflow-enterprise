import { z } from 'zod';

import { UserRefDto } from '../auth/auth.schemas';
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

// ---------- Lượt chấm thô (§5, TL duyệt kèm góp ý E): HR xem/thêm/hủy, nhân viên xem của mình ----------

export const AttendanceKind = z.enum(['IN', 'OUT']);
export type AttendanceKind = z.infer<typeof AttendanceKind>;
export const AttendanceSource = z.enum(['WEB', 'DEVICE', 'ADJUSTMENT']);
export type AttendanceSource = z.infer<typeof AttendanceSource>;

/**
 * Một lượt chấm, gồm cả lượt ĐÃ HỦY (log bất biến — ADR-121). IP/UA chỉ có ở route HR (`hr:manage`) và
 * route của chính nhân viên (NĐ 13 Đ.14 — §9); không vào CSV / thông báo.
 */
export const AttendanceEventDto = z.object({
  id: Uuid,
  userId: Uuid,
  kind: AttendanceKind,
  source: AttendanceSource,
  occurredAt: IsoDateTime,
  workDate: DateOnly,
  note: z.string().nullable(),
  createdBy: UserRefDto,
  voidedAt: IsoDateTime.nullable(),
  voidedBy: UserRefDto.nullable(),
  voidReason: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type AttendanceEventDto = z.infer<typeof AttendanceEventDto>;

/** `GET attendance/events` (HR) · `GET attendance/me/events` — lượt theo `workDate`, sắp theo giờ. */
export const AttendanceEventsDto = z.object({
  /** Múi giờ của lịch hiệu lực ngày đó (hiển thị giờ theo lịch, không theo máy). */
  timezone: z.string().min(1),
  events: z.array(AttendanceEventDto),
});
export type AttendanceEventsDto = z.infer<typeof AttendanceEventsDto>;

export const AttendanceEventsQuery = z.strictObject({ userId: Uuid, date: DateOnly });
export type AttendanceEventsQuery = z.infer<typeof AttendanceEventsQuery>;
export const MyAttendanceEventsQuery = z.strictObject({ date: DateOnly });
export type MyAttendanceEventsQuery = z.infer<typeof MyAttendanceEventsQuery>;

/** Lý do bắt buộc của ADJUSTMENT / void (§5) — không chép vào thông báo. */
const Reason = z.string().trim().min(1).max(500);

/**
 * `POST attendance/events` (ADJUSTMENT, `hr:manage`): HR nhập giờ theo LỊCH của ngày `date`
 * (`time` = HH:mm); `nextDay: true` cho lượt OUT sau nửa đêm vẫn thuộc `date` (giờ chốt 06:00).
 */
export const AdjustAttendanceBody = z.strictObject({
  userId: Uuid,
  kind: AttendanceKind,
  date: DateOnly,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải có dạng HH:mm.'),
  nextDay: z.boolean().default(false),
  reason: Reason,
});
export type AdjustAttendanceBody = z.infer<typeof AdjustAttendanceBody>;

export const VoidAttendanceBody = z.strictObject({ reason: Reason });
export type VoidAttendanceBody = z.infer<typeof VoidAttendanceBody>;

/** Kết quả ADJUSTMENT (201) / void (200): lượt + ô ngày đã tính lại — web cập nhật đúng 1 ô bảng tháng. */
export const AttendanceEventChangeDto = z.object({
  event: AttendanceEventDto,
  day: AttendanceDayDto,
});
export type AttendanceEventChangeDto = z.infer<typeof AttendanceEventChangeDto>;
