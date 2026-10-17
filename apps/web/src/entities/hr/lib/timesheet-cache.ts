import type {
  AttendanceEventChangeDto,
  AttendanceMemberMonthDto,
} from '@taskflow/contracts/attendance';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { ApiResult } from '@/shared/api';
import { hrKeys } from '../model/query-keys';

type Pages = InfiniteData<ApiResult<AttendanceMemberMonthDto[]>>;

/**
 * Sau ADJUSTMENT / hủy lượt: server trả `day` đã tính lại + `totals` của THÁNG đó cho người đó (TL d9, T-046 — một
 * quy tắc tổng duy nhất ở server, web không tự cộng) ⇒ thay ĐÚNG 1 ô + dòng tổng của người đó trong bảng tháng đang
 * cache (không tải lại 50 người).
 */
export function replaceTimesheetDay(
  client: QueryClient,
  wsId: string,
  userId: string,
  change: Pick<AttendanceEventChangeDto, 'day' | 'totals'>,
): void {
  const { day, totals } = change;
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
            return { ...row, days, totals };
          }),
        })),
      },
  );
}
