import type { IClock } from '../../../core/domain';
import { localToday } from '../domain/work-schedule';
import type { IWorkCalendarStore } from './ports/work-calendar-store.port';

/**
 * Múi giờ của lịch công ty có hiệu lực HÔM NAY (ADR-120) — chưa lưu lịch nào ⇒ `DEFAULT_SCHEDULE` (Asia/Ho_Chi_Minh).
 * Module company dùng cho `start_date` / `access_until` (CLK-HR-08) ⇒ cùng nguồn với ngày công của attendance.
 */
export async function scheduleTimeZoneNow(
  calendar: Pick<IWorkCalendarStore, 'scheduleVersions'>,
  clock: IClock,
): Promise<string> {
  return localToday(await calendar.scheduleVersions(), clock.now()).timezone;
}
