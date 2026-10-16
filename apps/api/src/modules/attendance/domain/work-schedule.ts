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
