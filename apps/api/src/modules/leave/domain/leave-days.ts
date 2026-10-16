import { BusinessRuleViolationError, ValidationError } from '../../../core/errors';

/** Ngày lịch `YYYY-MM-DD` (không giờ, không múi giờ — ADR-120: quy đổi theo múi giờ lịch ở tầng trên). */
export type CalendarDate = string;

export type LeaveDayPart = 'FULL' | 'AM' | 'PM';

/** Khoảng nghỉ của một đơn. `dayPart ≠ FULL` chỉ khi `startDate = endDate` (assertLeaveRange). */
export interface LeaveSpan {
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  readonly dayPart: LeaveDayPart;
}

/** Một ngày theo lịch HIỆU LỰC của chính ngày đó (WorkCalendarPort — đổi lịch giữa khoảng đã được tính sẵn). */
export interface CalendarDay {
  readonly date: CalendarDate;
  readonly isWorkday: boolean;
  readonly isHoliday: boolean;
}

/** Đơn vị đếm của domain: SỐ NGUYÊN nửa ngày (D-M6) — 1 ngày = 2. Chỉ đổi sang thập phân ở biên DTO/DB. */
export type HalfDays = number;

const HALVES_PER_PART: Record<LeaveDayPart, HalfDays> = { FULL: 2, AM: 1, PM: 1 };

function* datesBetween(start: CalendarDate, end: CalendarDate): Generator<CalendarDate> {
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`).getTime();
  while (d.getTime() <= last) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

/**
 * Luật hình dạng đơn (thiết kế §2 ADR-122, test-spec LD-07/08). Gọi TRƯỚC khi đọc lịch / khóa.
 * - `dayPart` AM/PM chỉ cho đơn một ngày (400 — như Zod ở biên).
 * - `endDate ≥ startDate` (400).
 * - Không vắt qua 2 năm ở v1 (422 `LEAVE_SPANS_YEARS`) — số dư tính theo năm của `startDate`.
 */
export function assertLeaveRange(span: LeaveSpan): void {
  if (span.endDate < span.startDate) {
    throw new ValidationError([
      {
        path: ['endDate'],
        code: 'too_small',
        message: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.',
      },
    ]);
  }
  if (span.dayPart !== 'FULL' && span.endDate !== span.startDate) {
    throw new ValidationError([
      {
        path: ['dayPart'],
        code: 'invalid_value',
        message: 'Nghỉ nửa ngày chỉ áp dụng cho đơn một ngày.',
      },
    ]);
  }
  if (span.startDate.slice(0, 4) !== span.endDate.slice(0, 4)) {
    throw new BusinessRuleViolationError(
      'LEAVE_SPANS_YEARS',
      'Đơn nghỉ không được kéo qua hai năm.',
    );
  }
}

/**
 * Số nửa ngày nghỉ THẬT SỰ (D-H3a: tính khi đọc, không lưu): mỗi ngày làm việc không phải ngày lễ trong
 * [start, end] được 2 (FULL) hoặc 1 (AM/PM). Ngày nghỉ theo lịch / ngày lễ = 0. `calendar` phải phủ đủ mọi
 * ngày của khoảng — thiếu là lỗi lập trình (không đoán "ngày nghỉ", tránh trừ phép sai âm thầm).
 */
export function countLeaveHalfDays(span: LeaveSpan, calendar: readonly CalendarDay[]): HalfDays {
  const byDate = new Map(calendar.map((day) => [day.date, day]));
  let total = 0;
  for (const date of datesBetween(span.startDate, span.endDate)) {
    const day = byDate.get(date);
    if (!day) throw new Error(`WorkCalendarPort không trả ngày ${date} trong khoảng đơn nghỉ`);
    if (day.isWorkday && !day.isHoliday) total += HALVES_PER_PART[span.dayPart];
  }
  return total;
}

/** Các "ô" (ngày:phần) mà đơn chiếm. FULL ⇒ cả AM lẫn PM. Tính theo LỊCH BIỂU của đơn, không theo lịch làm. */
export function occupiedSlots(span: LeaveSpan): string[] {
  const parts = span.dayPart === 'FULL' ? ['AM', 'PM'] : [span.dayPart];
  const slots: string[] = [];
  for (const date of datesBetween(span.startDate, span.endDate)) {
    for (const part of parts) slots.push(`${date}:${part}`);
  }
  return slots;
}

/** D-M2: hai đơn chồng nhau khi chung ít nhất một ô (ngày, phần). AM + PM cùng ngày KHÔNG chồng. */
export function overlaps(a: LeaveSpan, b: LeaveSpan): boolean {
  if (a.endDate < b.startDate || b.endDate < a.startDate) return false;
  const taken = new Set(occupiedSlots(a));
  return occupiedSlots(b).some((slot) => taken.has(slot));
}

/**
 * Các ngày của đơn nằm trong [from, to] kèm phần nghỉ (ApprovedLeavePort của attendance — thiết kế §4). Trả mọi
 * ngày LỊCH BIỂU kể cả ngày nghỉ/lễ: attendance tự áp thứ tự ưu tiên HOLIDAY > OFF > ON_LEAVE.
 */
export function leaveDatesWithin(
  span: LeaveSpan,
  from: CalendarDate,
  to: CalendarDate,
): { date: CalendarDate; part: LeaveDayPart }[] {
  const start = span.startDate > from ? span.startDate : from;
  const end = span.endDate < to ? span.endDate : to;
  if (end < start) return [];
  return [...datesBetween(start, end)].map((date) => ({ date, part: span.dayPart }));
}
