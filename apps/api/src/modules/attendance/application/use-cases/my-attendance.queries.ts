import type { AttendanceMonthDto, AttendanceTodayDto, YearMonth } from '@taskflow/contracts';

import { effectiveSchedule } from '../../domain/work-schedule';
import {
  lastDayOf,
  localToday,
  summarizeRange,
  todayCard,
  type AttendanceDeps,
} from '../attendance-days';
import { totalsOf } from '../attendance-totals';

export { lastDayOf } from '../attendance-days';

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
    const { timezone } = effectiveSchedule(versions, to);
    // T-046: tổng do server tính bằng CÙNG hàm với bảng HR — web không tự cộng.
    const today = localToday(versions, this.d.clock.now()).date;
    return { month: q.month, timezone, days, totals: totalsOf(days, today) };
  }
}
