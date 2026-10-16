import { weekdayOf, type LocalDate } from './local-time';

/**
 * Lịch làm việc theo PHIÊN BẢN có hiệu lực từ ngày (ADR-121): đổi lịch không làm sai số liệu tháng cũ.
 * Múi giờ đi theo phiên bản (ADR-120 sau góp ý A#3) — đổi múi giờ không dời giờ của các ngày đã qua.
 * Mọi mốc là phút kể từ 00:00 giờ địa phương của `timezone`.
 */
export interface WorkSchedule {
  effectiveFrom: LocalDate;
  timezone: string;
  /** Bitmask ngày làm: bit 0 = thứ Hai … bit 6 = Chủ nhật (seed T2–T7 = 0b0111111). */
  workdays: number;
  startMin: number;
  endMin: number;
  breakStartMin: number;
  breakEndMin: number;
  graceMin: number;
}

export function isWorkday(schedule: WorkSchedule, date: LocalDate): boolean {
  return (schedule.workdays & (1 << weekdayOf(date))) !== 0;
}

/**
 * Lịch MẶC ĐỊNH (TL chốt với B): migration KHÔNG seed / trigger dòng `work_schedules` — chưa có phiên bản nào
 * hiệu lực ở một ngày ⇒ dùng hằng số này (Prisma lẫn in-memory, cả `WorkCalendarPort` của leave). Chỉ khi
 * HR lưu lịch mới sinh dòng. T2–T7, 08:00–17:30, nghỉ trưa 12:00–13:30 (BLLĐ 2019 Đ.105: 8 h/ngày, 48 h/tuần).
 */
export const DEFAULT_SCHEDULE: WorkSchedule = Object.freeze({
  effectiveFrom: '1970-01-01',
  timezone: 'Asia/Ho_Chi_Minh',
  workdays: 0b0111111,
  startMin: 480,
  endMin: 1050,
  breakStartMin: 720,
  breakEndMin: 810,
  graceMin: 0,
});

/** Lịch dùng để tính ngày `date`: phiên bản hiệu lực, không có ⇒ `DEFAULT_SCHEDULE`. */
export function effectiveSchedule(
  versions: readonly WorkSchedule[],
  date: LocalDate,
): WorkSchedule {
  return scheduleFor(versions, date) ?? DEFAULT_SCHEDULE;
}

/** Phiên bản hiệu lực cho `date` = phiên bản có `effectiveFrom` lớn nhất ≤ `date`; chưa có ⇒ null. */
export function scheduleFor(
  versions: readonly WorkSchedule[],
  date: LocalDate,
): WorkSchedule | null {
  let best: WorkSchedule | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
  }
  return best;
}
