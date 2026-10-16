import type { AttendanceMonthDto, AttendanceTodayDto, YearMonth } from '@taskflow/contracts';

import { scheduleFor } from '../../domain/work-schedule';
import {
  DEFAULT_TIMEZONE,
  summarizeRange,
  todayCard,
  type AttendanceDeps,
} from '../attendance-days';

/** Ngày cuối của tháng `YYYY-MM`. */
export function lastDayOf(month: YearMonth): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** `GET attendance/me/today` · `GET attendance/me?month=` — chỉ dữ liệu của chính người gọi. */
export class MyAttendanceQueries {
  constructor(private readonly d: AttendanceDeps) {}

  today(q: { workspaceId: string; userId: string }): Promise<AttendanceTodayDto> {
    return todayCard(this.d, q);
  }

  async month(q: {
    workspaceId: string;
    userId: string;
    month: YearMonth;
  }): Promise<AttendanceMonthDto> {
    const from = `${q.month}-01`;
    const to = lastDayOf(q.month);
    const days = await summarizeRange(this.d, { ...q, from, to });
    // Múi giờ hiển thị: của lịch hiệu lực ở ngày cuối tháng (từng ngày đã tính theo múi giờ của phiên bản
    // hiệu lực ở chính ngày đó — đổi múi giờ giữa tháng hiếm).
    const versions = await this.d.calendar.scheduleVersions(q.workspaceId);
    const timezone = scheduleFor(versions, to)?.timezone ?? DEFAULT_TIMEZONE;
    return { month: q.month, timezone, days };
  }
}
