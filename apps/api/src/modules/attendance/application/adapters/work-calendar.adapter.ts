import { addDays, daysBetween, type LocalDate } from '../../domain/local-time';
import { effectiveSchedule, isWorkday, type WorkSchedule } from '../../domain/work-schedule';
import type { IWorkCalendarStore } from '../ports/work-calendar-store.port';

/** Một ngày theo lịch hiệu lực ngày đó — khớp cấu trúc `WorkCalendarDay` của leave (ADR-093: không import). */
export interface WorkingDay {
  date: LocalDate;
  isWorkday: boolean;
  isHoliday: boolean;
  schedule: WorkSchedule;
}

/**
 * Adapter cho `IWorkCalendarPort` của module leave (thiết kế §4, D-H4) — nối ở composition root. Trả MỌI ngày
 * của `[from, to]` (gồm cả hai đầu, kể cả ngày nghỉ) theo phiên bản lịch hiệu lực của TỪNG ngày + ngày lễ
 * hiện tại của công ty; chưa lưu lịch ⇒ `DEFAULT_SCHEDULE`. Hai truy vấn cho cả khoảng (leave gọi theo năm).
 */
export class AttendanceWorkCalendar {
  constructor(private readonly calendar: IWorkCalendarStore) {}

  async workingDays(q: { from: LocalDate; to: LocalDate }): Promise<WorkingDay[]> {
    const [versions, holidays] = await Promise.all([
      this.calendar.scheduleVersions(),
      this.calendar.holidays(q),
    ]);
    const holidaySet = new Set(holidays.map((h) => h.date));
    const n = daysBetween(q.from, q.to) + 1;
    return Array.from({ length: Math.max(n, 0) }, (_, i) => {
      const date = addDays(q.from, i);
      const schedule = effectiveSchedule(versions, date);
      return {
        date,
        isWorkday: isWorkday(schedule, date),
        isHoliday: holidaySet.has(date),
        schedule,
      };
    });
  }
}
