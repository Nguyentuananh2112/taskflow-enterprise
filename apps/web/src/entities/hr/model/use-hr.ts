import type { LeaveStatus } from '@taskflow/contracts/hr';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { hrAttendanceApi, hrLeaveApi } from '../api/hr.api';
import { hrKeys } from './query-keys';

const nextCursor = (last: {
  page?: { hasMore: boolean; nextCursor: string | null } | undefined;
}) => (last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined);

/** "Hôm nay" cả công ty — làm mới mỗi phút (ai vừa vào/ra). */
export function useCompanyToday(enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.today(),
    queryFn: () => hrAttendanceApi.today(),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Bảng công tháng, 50 nhân viên mỗi trang. */
export function useTimesheet(month: string | null) {
  return useInfiniteQuery({
    queryKey: hrKeys.month(month ?? ''),
    queryFn: ({ pageParam }) => hrAttendanceApi.month(month ?? '', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: month !== null,
    staleTime: 60_000,
  });
}

/** Lượt thô của một người trong một ngày (gồm lượt đã hủy, IP/UA — chỉ HR). */
export function useHrEvents(userId: string, date: string | null) {
  return useQuery({
    queryKey: hrKeys.events(userId, date ?? ''),
    queryFn: () => hrAttendanceApi.events(userId, date ?? ''),
    enabled: date !== null,
  });
}

export function useSchedules(enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.schedules(),
    queryFn: () => hrAttendanceApi.schedules(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useHolidays(year: number | null) {
  return useQuery({
    queryKey: hrKeys.holidays(year ?? 0),
    queryFn: () => hrAttendanceApi.holidays(year ?? 0),
    enabled: year !== null,
    staleTime: 5 * 60_000,
  });
}

/** Đơn nghỉ cả công ty theo trạng thái (`ALL` = mọi trạng thái), mới nhất trước. */
export function useHrLeaveRequests(status: LeaveStatus | 'ALL', enabled: boolean) {
  return useInfiniteQuery({
    queryKey: hrKeys.leaveList(status),
    queryFn: ({ pageParam }) => hrLeaveApi.list(status === 'ALL' ? undefined : status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled,
    staleTime: 30_000,
  });
}

/** Số đơn chờ duyệt cả công ty (trang đầu ≤ 50; `more` ⇒ "50+"). Chỉ gọi khi có `hr:manage`. */
export function useHrPendingLeaveCount(enabled: boolean) {
  return useQuery({
    queryKey: hrKeys.leavePendingCount(),
    queryFn: () => hrLeaveApi.list('PENDING'),
    select: (r) => ({ count: r.data.length, more: r.page?.hasMore ?? false }),
    enabled,
    staleTime: 30_000,
  });
}

export function useLeaveBalances(year: number | null) {
  return useInfiniteQuery({
    queryKey: hrKeys.balances(year ?? 0),
    queryFn: ({ pageParam }) => hrLeaveApi.balances(year ?? 0, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: year !== null,
    staleTime: 60_000,
  });
}

/** Chính sách phép của một năm (ADR-131) — năm chưa đặt ⇒ server trả bản kế thừa / mức luật. */
export function useLeavePolicy(year: number, enabled = true) {
  return useQuery({
    queryKey: hrKeys.policy(year),
    queryFn: () => hrLeaveApi.policy(year),
    enabled,
    staleTime: 0,
  });
}
