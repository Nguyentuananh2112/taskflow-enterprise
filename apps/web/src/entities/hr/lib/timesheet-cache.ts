import type { AttendanceDayDto, AttendanceMemberMonthDto } from '@taskflow/contracts/attendance';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { ApiResult } from '@/shared/api';
import { hrKeys } from '../model/query-keys';

type Pages = InfiniteData<ApiResult<AttendanceMemberMonthDto[]>>;

/**
 * Tổng của một người — CÙNG quy tắc với server (T-046, TL d9): chỉ đếm `date ≤ today`, phép sau đó vào
 * `upcomingLeaveDays`, vắng/nghỉ bước 0,5. `today` lấy từ `throughDate` cũ của chính dòng đó (server đã tính: hôm
 * nay, cuối tháng nếu tháng đã qua, `null` nếu tháng chưa tới ⇒ mọi ngày là tương lai) — không đọc đồng hồ máy.
 */
export function totalsOf(
  days: readonly AttendanceDayDto[],
  through: string | null,
): AttendanceMemberMonthDto['totals'] {
  const today = through ?? '';
  // Ngày công (không NOT_EMPLOYED / HOLIDAY / OFF); chỉ đếm `date ≤ today`, phép sau đó ⇒ upcomingLeaveDays.
  const workday = (d: AttendanceDayDto) =>
    d.status !== 'NOT_EMPLOYED' && d.status !== 'HOLIDAY' && d.status !== 'OFF';
  const counted = days.filter((d) => workday(d) && d.date <= today);
  const sum = (f: (d: AttendanceDayDto) => number) => counted.reduce((n, d) => n + f(d), 0);
  const leave = (d: AttendanceDayDto) => (d.leave === 'FULL' ? 1 : d.leave ? 0.5 : 0);
  const lastCounted = days.filter((d) => d.date <= today).at(-1)?.date ?? null;
  return {
    workedMin: sum((d) => d.workedMin),
    lateDays: sum((d) => (d.late ? 1 : 0)),
    lateMin: sum((d) => d.lateMin),
    earlyDays: sum((d) => (d.early ? 1 : 0)),
    earlyMin: sum((d) => d.earlyMin),
    absentDays: sum((d) => (d.status === 'ABSENT' ? (d.absentHalf ? 0.5 : 1) : 0)),
    leaveDays: sum(leave),
    missingOutDays: sum((d) => (d.status === 'MISSING_OUT' ? 1 : 0)),
    presentDays: sum((d) => (d.status === 'PRESENT' || d.status === 'MISSING_OUT' ? 1 : 0)),
    upcomingLeaveDays: days
      .filter((d) => workday(d) && d.date > today)
      .reduce((n, d) => n + leave(d), 0),
    throughDate: lastCounted,
  };
}

/**
 * Sau ADJUSTMENT / hủy lượt: server trả `day` đã tính lại (TL chốt) ⇒ thay ĐÚNG 1 ô của người đó trong
 * bảng tháng đang cache (không tải lại 50 người) rồi tính lại dòng tổng của người đó.
 */
export function replaceTimesheetDay(
  client: QueryClient,
  wsId: string,
  userId: string,
  day: AttendanceDayDto,
): void {
  client.setQueryData<Pages>(
    hrKeys.month(wsId, day.date.slice(0, 7)),
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          data: page.data.map((row) => {
            if (row.user.id !== userId) return row;
            const days = row.days.map((d) => (d.date === day.date ? { ...d, ...day } : d));
            return { ...row, days, totals: totalsOf(days, row.totals.throughDate) };
          }),
        })),
      },
  );
}
