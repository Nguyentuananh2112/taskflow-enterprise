import type { AttendanceDayDto, AttendanceMemberMonthDto } from '@taskflow/contracts/attendance';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { ApiResult } from '@/shared/api';
import { hrKeys } from '../model/query-keys';

type Pages = InfiniteData<ApiResult<AttendanceMemberMonthDto[]>>;

/** Tổng của một người — CÙNG quy tắc với server (A chốt): vắng/nghỉ bước 0,5. */
export function totalsOf(days: readonly AttendanceDayDto[]): AttendanceMemberMonthDto['totals'] {
  const sum = (f: (d: AttendanceDayDto) => number) => days.reduce((n, d) => n + f(d), 0);
  return {
    workedMin: sum((d) => d.workedMin),
    lateDays: sum((d) => (d.late ? 1 : 0)),
    lateMin: sum((d) => d.lateMin),
    earlyDays: sum((d) => (d.early ? 1 : 0)),
    earlyMin: sum((d) => d.earlyMin),
    absentDays: sum((d) => (d.status === 'ABSENT' ? (d.absentHalf ? 0.5 : 1) : 0)),
    leaveDays: sum((d) => (d.leave === 'FULL' ? 1 : d.leave ? 0.5 : 0)),
    missingOutDays: sum((d) => (d.status === 'MISSING_OUT' ? 1 : 0)),
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
            return { ...row, days, totals: totalsOf(days) };
          }),
        })),
      },
  );
}
