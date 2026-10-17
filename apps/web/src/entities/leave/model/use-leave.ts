import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import type { SubmitLeaveBody } from '@taskflow/contracts/leave';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';

import { leaveApi } from '../api/leave.api';

type Draft = Pick<SubmitLeaveBody, 'type' | 'startDate' | 'endDate' | 'dayPart'>;

// Mốc 3.5: dưới gốc ['company'] (ADR-139) — đăng xuất / SESSION_REVOKED ⇒ `queryClient.clear()` dọn hết.
export const leaveKeys = {
  all: () => ['company', 'leave'] as const,
  mine: () => ['company', 'leave', 'mine'] as const,
  minePending: () => ['company', 'leave', 'mine-pending'] as const,
  balance: (year: number) => ['company', 'leave', 'balance', year] as const,
  preview: (d: Draft | null) => ['company', 'leave', 'preview', d] as const,
};

/** Đơn của tôi, mới nhất trước, phân trang cursor (50/trang) ⇒ "Tải thêm". */
export function useMyLeaveRequests(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: leaveKeys.mine(),
    queryFn: ({ pageParam }) => leaveApi.mine(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    select: (d) => d.pages.flatMap((p) => p.data),
    enabled,
    staleTime: 30_000,
  });
}

/** Số đơn chờ duyệt của tôi (trang đầu ≤ 50; `more` ⇒ hiện "50+"). Dưới `leaveKeys.all` ⇒ gửi/hủy/duyệt làm mới. */
export function useMyPendingLeaveCount(enabled: boolean) {
  return useQuery({
    queryKey: leaveKeys.minePending(),
    queryFn: () => leaveApi.minePending(),
    select: (r) => ({ count: r.data.length, more: r.page?.hasMore ?? false }),
    enabled,
    staleTime: 30_000,
  });
}

export function useMyLeaveBalance(year: number | null) {
  return useQuery({
    queryKey: leaveKeys.balance(year ?? 0),
    queryFn: () => leaveApi.myBalance(year ?? 0),
    enabled: year !== null,
    staleTime: 30_000,
  });
}

/**
 * Xem trước số ngày khi người dùng đổi loại / ngày / buổi (debounce 400 ms — TL duyệt). Không gửi khi
 * khoảng ngày chưa hợp lệ (`draft = null`). Lỗi trả như khi gửi (vd không đủ phép) — form hiển thị câu.
 */
export function useLeavePreview(draft: Draft | null) {
  const debounced = useDebouncedValue(draft, 400);
  return useQuery({
    queryKey: leaveKeys.preview(debounced),
    queryFn: () => leaveApi.preview(debounced as Draft),
    enabled: debounced !== null,
    staleTime: 15_000,
    retry: false,
  });
}
