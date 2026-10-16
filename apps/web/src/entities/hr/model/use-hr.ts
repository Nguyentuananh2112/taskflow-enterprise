import type { LeaveStatus } from '@taskflow/contracts/hr';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { hrAttendanceApi, hrLeaveApi } from '../api/hr.api';
import { hrKeys } from './query-keys';

const nextCursor = (last: {
  page?: { hasMore: boolean; nextCursor: string | null } | undefined;
}) => (last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined);

/** "Hôm nay" cả công ty — làm mới mỗi phút (ai vừa vào/ra). */
export function useCompanyToday(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.today(wsId),
    queryFn: () => hrAttendanceApi.today(wsId),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Bảng công tháng, 50 nhân viên mỗi trang. */
export function useTimesheet(wsId: string, month: string | null) {
  return useInfiniteQuery({
    queryKey: hrKeys.month(wsId, month ?? ''),
    queryFn: ({ pageParam }) => hrAttendanceApi.month(wsId, month ?? '', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: month !== null,
    staleTime: 60_000,
  });
}

/** Lượt thô của một người trong một ngày (gồm lượt đã hủy, IP/UA — chỉ HR). */
export function useHrEvents(wsId: string, userId: string, date: string | null) {
  return useQuery({
    queryKey: hrKeys.events(wsId, userId, date ?? ''),
    queryFn: () => hrAttendanceApi.events(wsId, userId, date ?? ''),
    enabled: date !== null,
  });
}

export function useSchedules(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.schedules(wsId),
    queryFn: () => hrAttendanceApi.schedules(wsId),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useHolidays(wsId: string, year: number | null) {
  return useQuery({
    queryKey: hrKeys.holidays(wsId, year ?? 0),
    queryFn: () => hrAttendanceApi.holidays(wsId, year ?? 0),
    enabled: year !== null,
    staleTime: 5 * 60_000,
  });
}

/** Đơn nghỉ cả công ty theo trạng thái (`ALL` = mọi trạng thái), mới nhất trước. */
export function useHrLeaveRequests(wsId: string, status: LeaveStatus | 'ALL', enabled: boolean) {
  return useInfiniteQuery({
    queryKey: hrKeys.leaveList(wsId, status),
    queryFn: ({ pageParam }) =>
      hrLeaveApi.list(wsId, status === 'ALL' ? undefined : status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled,
    staleTime: 30_000,
  });
}

export function useLeaveBalances(wsId: string, year: number | null) {
  return useInfiniteQuery({
    queryKey: hrKeys.balances(wsId, year ?? 0),
    queryFn: ({ pageParam }) => hrLeaveApi.balances(wsId, year ?? 0, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: year !== null,
    staleTime: 60_000,
  });
}
