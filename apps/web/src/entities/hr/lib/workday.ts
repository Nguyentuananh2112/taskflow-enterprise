import type { WorkScheduleDto } from '@taskflow/contracts/attendance';

/** Lịch mặc định khi chưa có phiên bản (A — DEFAULT_SCHEDULE): T2–T7. */
export const DEFAULT_WORKDAYS = 0b0111111;

/**
 * Ngày `YYYY-MM-DD` có là ngày làm theo phiên bản lịch hiệu lực (effectiveFrom ≤ ngày, mới nhất)? `workdays`: bit0 =
 * T2 … bit6 = CN. Tính theo chuỗi ngày (UTC), không theo múi giờ máy.
 */
export function isWorkdayOn(
  schedules: ReadonlyArray<Pick<WorkScheduleDto, 'effectiveFrom' | 'workdays'>>,
  date: string,
): boolean {
  const effective = [...schedules]
    .filter((s) => s.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const mask = effective?.workdays ?? DEFAULT_WORKDAYS;
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // T2 = 0 … CN = 6
  return (mask & (1 << weekday)) !== 0;
}
