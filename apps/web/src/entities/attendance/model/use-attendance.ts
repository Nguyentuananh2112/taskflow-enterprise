import { useQuery } from '@tanstack/react-query';

import { attendanceApi } from '../api/attendance.api';
import { attendanceKeys } from './query-keys';

/**
 * Hôm nay của tôi. Trạng thái đổi theo GIỜ (PENDING → ABSENT, MISSING_OUT) dù không ai thao tác ⇒
 * làm mới mỗi 5 phút và khi quay lại tab. `enabled=false` cho VIEWER (không có `attendance:self`).
 */
export function useAttendanceToday(enabled: boolean) {
  return useQuery({
    queryKey: attendanceKeys.today(),
    queryFn: () => attendanceApi.today(),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useAttendanceMonth(month: string, enabled: boolean) {
  return useQuery({
    queryKey: attendanceKeys.month(month),
    queryFn: () => attendanceApi.month(month),
    enabled,
    staleTime: 60_000,
  });
}

/** Lượt chấm của tôi trong `date` — chỉ tải khi mở chi tiết ngày. */
export function useMyAttendanceEvents(date: string | null) {
  return useQuery({
    queryKey: attendanceKeys.myEvents(date ?? ''),
    queryFn: () => attendanceApi.myEvents(date ?? ''),
    enabled: date !== null,
    staleTime: 30_000,
  });
}
