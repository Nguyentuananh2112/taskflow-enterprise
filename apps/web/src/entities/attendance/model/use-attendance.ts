import { useQuery } from '@tanstack/react-query';

import { attendanceApi } from '../api/attendance.api';
import { attendanceKeys } from './query-keys';

/**
 * Hôm nay của tôi. Trạng thái đổi theo GIỜ (PENDING → ABSENT, MISSING_OUT) dù không ai thao tác ⇒
 * làm mới mỗi 5 phút và khi quay lại tab. `enabled=false` cho VIEWER (không có `attendance:self`).
 */
export function useAttendanceToday(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: attendanceKeys.today(wsId),
    queryFn: () => attendanceApi.today(wsId),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useAttendanceMonth(wsId: string, month: string, enabled: boolean) {
  return useQuery({
    queryKey: attendanceKeys.month(wsId, month),
    queryFn: () => attendanceApi.month(wsId, month),
    enabled,
    staleTime: 60_000,
  });
}
