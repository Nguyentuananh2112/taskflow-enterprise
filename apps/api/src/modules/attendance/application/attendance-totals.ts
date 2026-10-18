import type { AttendanceDayDto, AttendanceTotalsDto } from '@taskflow/contracts';

import type { LocalDate } from '../domain/local-time';
import { lastDayOf, localToday, summarizeRange, type AttendanceDeps } from './attendance-days';

/**
 * Tổng tháng của một người — CÙNG một hàm cho `me?month=` và bảng HR / CSV (T-046, TL d9). Chỉ đếm ngày
 * `date ≤ today` (hôm nay theo lịch) ở MỌI cột; phép đã duyệt sau hôm nay ⇒ `upcomingLeaveDays`. Ngày công mới đếm:
 * RETENTION_EXPIRED / NOT_EMPLOYED / HOLIDAY / OFF ⇒ 0 (kể cả phép trùng lễ / ngày nghỉ) — trừ giờ làm thật trên ngày
 * lễ / ngày nghỉ (TL #A1) được cộng vào `workedMin`, không thành ngày đi làm. Vắng: ABSENT = 1, ABSENT + `absentHalf` = 0,5.
 * Nghỉ phép: FULL = 1, AM/PM = 0,5. Đi làm: PRESENT + MISSING_OUT. `workedMin` của ngày chưa có giờ ra đã là 0
 * (summarizeDay) ⇒ hôm nay đang làm không cộng; muộn hôm nay đã biết lúc vào ⇒ có tính.
 */
export function totalsOf(days: readonly AttendanceDayDto[], today: LocalDate): AttendanceTotalsDto {
  const t: AttendanceTotalsDto = {
    workedMin: 0,
    lateDays: 0,
    lateMin: 0,
    earlyDays: 0,
    earlyMin: 0,
    absentDays: 0,
    leaveDays: 0,
    missingOutDays: 0,
    presentDays: 0,
    upcomingLeaveDays: 0,
    throughDate: null,
  };
  const leaveOf = (d: AttendanceDayDto) => (d.leave === 'FULL' ? 1 : d.leave === null ? 0 : 0.5);
  for (const d of days) {
    if (
      d.status === 'RETENTION_EXPIRED' ||
      d.status === 'NOT_EMPLOYED' ||
      d.status === 'HOLIDAY' ||
      d.status === 'OFF'
    ) {
      if (d.date <= today && (t.throughDate === null || d.date > t.throughDate))
        t.throughDate = d.date;
      if (d.date <= today && (d.status === 'HOLIDAY' || d.status === 'OFF'))
        t.workedMin += d.workedMin;
      continue;
    }
    if (d.date > today) {
      t.upcomingLeaveDays += leaveOf(d);
      continue;
    }
    if (t.throughDate === null || d.date > t.throughDate) t.throughDate = d.date;
    t.workedMin += d.workedMin;
    t.lateMin += d.lateMin;
    t.earlyMin += d.earlyMin;
    if (d.late) t.lateDays += 1;
    if (d.early) t.earlyDays += 1;
    if (d.status === 'ABSENT') t.absentDays += d.absentHalf ? 0.5 : 1;
    if (d.status === 'MISSING_OUT') t.missingOutDays += 1;
    if (d.status === 'PRESENT' || d.status === 'MISSING_OUT') t.presentDays += 1;
    t.leaveDays += leaveOf(d);
  }
  return t;
}

/**
 * Cả tháng chứa `date` của một người + tổng tháng (T-046): sau ADJUSTMENT / hủy lượt, server trả cả ô ngày lẫn dòng
 * tổng đã tính lại để web thay đúng chỗ, KHÔNG tự cộng. Một lần tính cả tháng (ô ngày lấy từ đó).
 */
export async function monthTotalsOf(
  d: AttendanceDeps,
  q: { userId: string; date: LocalDate },
): Promise<{ day: AttendanceDayDto; totals: AttendanceTotalsDto }> {
  const month = q.date.slice(0, 7);
  const [days, versions] = await Promise.all([
    summarizeRange(d, {
      userId: q.userId,
      from: `${month}-01`,
      to: lastDayOf(month),
    }),
    d.calendar.scheduleVersions(),
  ]);
  const today = localToday(versions, d.clock.now()).date;
  return { day: days.find((x) => x.date === q.date)!, totals: totalsOf(days, today) };
}
