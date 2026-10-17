import { z } from 'zod';

import { UserRefDto } from '../auth/auth.schemas';
import { Cursor, DateOnly, IsoDateTime, Uuid, limitQuery } from '../common/primitives';
import { AttendanceKind, AttendanceSource } from '../hr/hr.schemas';

// Chấm công (T-038, thiết kế attendance-leave.md §4–§5, hợp đồng web chốt với E cho T-041a).
// Giờ trả về là ISO UTC; web hiển thị theo `timezone` của LỊCH hiệu lực (ADR-120), không theo máy.

/**
 * Trạng thái ngày — thứ tự ưu tiên NOT_EMPLOYED > HOLIDAY > OFF > ON_LEAVE > PRESENT/MISSING_OUT > ABSENT >
 * PENDING. `NOT_EMPLOYED`: ngày trước khi gia nhập / sau khi rời mà không có lượt chấm — không phải ngày
 * công, 0 ở mọi tổng và CSV (TL chốt).
 */
export const DayStatus = z.enum([
  'NOT_EMPLOYED',
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
/** Header bắt buộc của check-in/out (OpenAPI `in: header`). */
export const IdempotencyKeyHeaders = z.object({ [IDEMPOTENCY_KEY_HEADER]: IdempotencyKey });

/** `:eventId` của `POST attendance/events/:eventId/void`. */
export const AttendanceEventParams = z.object({ wsId: Uuid, eventId: Uuid });
export type AttendanceEventParams = z.infer<typeof AttendanceEventParams>;

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
  /** Múi giờ của lịch hiệu lực NGÀY ĐÓ — đổi lịch giữa tháng vẫn hiển thị đúng giờ (H, T-041c). */
  timezone: z.string().min(1),
  isWorkday: z.boolean(),
  holidayName: z.string().nullable(),
  workedMin: z.int().min(0),
  lateMin: z.int().min(0),
  earlyMin: z.int().min(0),
  ...DayFlags,
});
export type AttendanceDayDto = z.infer<typeof AttendanceDayDto>;

const HalfDays = z.number().min(0).multipleOf(0.5);

/**
 * Tổng tháng của một người — CÙNG một hàm cho `me?month=` và bảng HR (T-046, TL d9). Chỉ đếm ngày `date ≤ hôm nay`
 * (theo lịch) ở mọi cột; NOT_EMPLOYED / OFF / HOLIDAY tính 0; vắng / nghỉ theo bước 0,5 ngày. `workedMin` chỉ có ở
 * ngày đã có giờ ra (hôm nay đang làm hiện riêng ở thẻ hôm nay). Web KHÔNG tự cộng.
 */
export const AttendanceTotalsDto = z.object({
  workedMin: z.int().min(0),
  lateDays: z.int().min(0),
  lateMin: z.int().min(0),
  earlyDays: z.int().min(0),
  earlyMin: z.int().min(0),
  absentDays: HalfDays,
  leaveDays: HalfDays,
  missingOutDays: z.int().min(0),
  /** Ngày công có đi làm: PRESENT + MISSING_OUT (nghỉ nửa ngày, làm nửa kia vẫn là 1). */
  presentDays: z.int().min(0),
  /** Phép đã duyệt SAU hôm nay (ngày công), bước 0,5 — cột "Phép sắp tới". */
  upcomingLeaveDays: HalfDays,
  /** Ngày cuối được tính (= hôm nay, hoặc cuối tháng nếu tháng đã qua); tháng chưa tới ⇒ `null`. */
  throughDate: DateOnly.nullable(),
});
export type AttendanceTotalsDto = z.infer<typeof AttendanceTotalsDto>;

/** `GET attendance/me?month=` — `days` đủ mọi ngày của tháng (kể cả OFF / PENDING tương lai). */
export const AttendanceMonthDto = z.object({
  month: YearMonth,
  timezone: z.string().min(1),
  days: z.array(AttendanceDayDto),
  totals: AttendanceTotalsDto,
});
export type AttendanceMonthDto = z.infer<typeof AttendanceMonthDto>;

// ---------- Lượt chấm thô (§5, TL duyệt kèm góp ý E): HR xem/thêm/hủy, nhân viên xem của mình ----------

// `AttendanceKind` / `AttendanceSource`: định nghĩa DUY NHẤT ở `hr/hr.schemas.ts` (T-037, khớp enum Postgres
// của migration 3 — TL chốt), import lại ở đây.

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
  /** Tổng THÁNG của `day` (người đó) tính lại ở server — web thay dòng tổng, không tự cộng (T-046, TL d9). */
  totals: AttendanceTotalsDto,
});
export type AttendanceEventChangeDto = z.infer<typeof AttendanceEventChangeDto>;

// ---------- Lịch làm việc theo phiên bản + ngày lễ (§4–§5): đọc mọi thành viên, ghi `hr:manage` ----------

const IANA_SHAPE = /^(UTC|[A-Z][A-Za-z_-]*(\/[A-Za-z0-9_+-]+){1,2})$/;
/**
 * IANA hợp lệ (AT-19): đúng dạng `Vùng/Thành_phố` (hoặc `UTC`) VÀ runtime nhận làm `timeZone`. KHÔNG dùng
 * `Intl.supportedValuesOf('timeZone')`: danh sách đó chỉ có tên chuẩn CLDR — thiếu `Asia/Ho_Chi_Minh` (có
 * `Asia/Saigon`), `Asia/Kolkata`… Còn `Intl.DateTimeFormat` một mình lại nhận cả `+07:00`, `utc` ⇒ kiểm dạng trước.
 */
export const isSupportedTimeZone = (tz: string) => {
  if (!IANA_SHAPE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const TimeZoneName = z
  .string()
  .max(64)
  .refine(isSupportedTimeZone, 'Múi giờ không hợp lệ (IANA, vd Asia/Ho_Chi_Minh).');

const DayMinute = z.int().min(0).max(1440);

/**
 * `POST attendance/schedules` — phiên bản lịch hiệu lực từ `effectiveFrom` (≥ hôm nay theo lịch đang hiệu lực,
 * nếu không 422 `SCHEDULE_IN_PAST`). Trùng `effectiveFrom` với phiên bản đã có ⇒ thay phiên bản đó.
 * `workdays`: bit0 = T2 … bit6 = CN. Không nghỉ trưa ⇒ `breakStartMin = breakEndMin`.
 */
export const CreateWorkScheduleBody = z
  .strictObject({
    effectiveFrom: DateOnly,
    timezone: TimeZoneName,
    workdays: z.int().min(1).max(127),
    startMin: DayMinute,
    endMin: DayMinute,
    breakStartMin: DayMinute,
    breakEndMin: DayMinute,
    graceMin: z.int().min(0).max(120),
  })
  .refine((s) => s.startMin < s.endMin, {
    path: ['endMin'],
    message: 'Giờ kết thúc phải sau giờ bắt đầu.',
  })
  .refine(
    (s) =>
      s.startMin <= s.breakStartMin &&
      s.breakStartMin <= s.breakEndMin &&
      s.breakEndMin <= s.endMin,
    { path: ['breakStartMin'], message: 'Giờ nghỉ phải nằm trong ca.' },
  );
export type CreateWorkScheduleBody = z.infer<typeof CreateWorkScheduleBody>;

/** Một phiên bản lịch đã lưu. `GET attendance/schedules` rỗng ⇒ workspace đang dùng lịch mặc định. */
export const WorkScheduleDto = z.object({
  effectiveFrom: DateOnly,
  timezone: z.string().min(1),
  workdays: z.int().min(1).max(127),
  ...WorkShiftDto.shape,
  createdBy: UserRefDto,
  createdAt: IsoDateTime,
});
export type WorkScheduleDto = z.infer<typeof WorkScheduleDto>;

export const HolidayDto = z.object({ date: DateOnly, name: z.string() });
export type HolidayDto = z.infer<typeof HolidayDto>;

export const HolidayListQuery = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2100),
});
export type HolidayListQuery = z.infer<typeof HolidayListQuery>;

export const HolidayDateParams = z.object({ wsId: Uuid, date: DateOnly });
export type HolidayDateParams = z.infer<typeof HolidayDateParams>;

/**
 * `PUT attendance/holidays/:date` (tạo / đổi tên). Ngày đã qua: chỉ OWNER và bắt buộc `reason`
 * (HR khác ⇒ 422 `HOLIDAY_IN_PAST`; OWNER thiếu ⇒ 422 `REASON_REQUIRED`, AT-18).
 */
export const PutHolidayBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  reason: Reason.optional(),
});
export type PutHolidayBody = z.infer<typeof PutHolidayBody>;

/** `DELETE attendance/holidays/:date` ⇒ 204 (idempotent); luật ngày đã qua như PUT. */
export const DeleteHolidayBody = z.strictObject({ reason: Reason.optional() });
export type DeleteHolidayBody = z.infer<typeof DeleteHolidayBody>;

// ---------- Bảng công cả công ty (HR, `hr:manage`) — chốt với H (T-041c) ----------

/** Một người trong bảng HR. `left`: không còn là nhân viên nhưng có dữ liệu trong khoảng (R30). */
const HrMemberRef = { user: UserRefDto, left: z.boolean() };

/** `GET attendance/today` — không phân trang; sắp theo tên (tiếng Việt), rồi id. */
export const AttendanceCompanyTodayDto = z.object({
  serverNow: IsoDateTime,
  date: DateOnly,
  timezone: z.string().min(1),
  isWorkday: z.boolean(),
  isHoliday: z.boolean(),
  holidayName: z.string().nullable(),
  schedule: WorkShiftDto.nullable(),
  members: z.array(z.object({ ...HrMemberRef, day: AttendanceDayDto })),
});
export type AttendanceCompanyTodayDto = z.infer<typeof AttendanceCompanyTodayDto>;

/** Một dòng của `GET attendance?month=` (envelope `data[]` + `meta.page`). */
export const AttendanceMemberMonthDto = z.object({
  ...HrMemberRef,
  days: z.array(AttendanceDayDto),
  totals: AttendanceTotalsDto,
});
export type AttendanceMemberMonthDto = z.infer<typeof AttendanceMemberMonthDto>;

export const AttendanceCompanyMonthQuery = z.strictObject({
  month: YearMonth,
  cursor: Cursor.optional(),
  limit: limitQuery(50, 50),
});
export type AttendanceCompanyMonthQuery = z.infer<typeof AttendanceCompanyMonthQuery>;
