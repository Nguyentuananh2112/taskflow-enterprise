import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import type { SubmitLeaveBody } from '@taskflow/contracts/leave';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';

import { leaveApi } from '../api/leave.api';

type Draft = Pick<SubmitLeaveBody, 'type' | 'startDate' | 'endDate' | 'dayPart'>;

// Dưới gốc ['ws', wsId] ⇒ mất quyền workspace dọn luôn (frontend.md §3.2).
export const leaveKeys = {
  all: (wsId: string) => ['ws', wsId, 'leave'] as const,
  mine: (wsId: string) => ['ws', wsId, 'leave', 'mine'] as const,
  balance: (wsId: string, year: number) => ['ws', wsId, 'leave', 'balance', year] as const,
  preview: (wsId: string, d: Draft | null) => ['ws', wsId, 'leave', 'preview', d] as const,
};

/** Đơn của tôi, mới nhất trước, phân trang cursor (50/trang) ⇒ "Tải thêm". */
export function useMyLeaveRequests(wsId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: leaveKeys.mine(wsId),
    queryFn: ({ pageParam }) => leaveApi.mine(wsId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    select: (d) => d.pages.flatMap((p) => p.data),
    enabled,
    staleTime: 30_000,
  });
}

export function useMyLeaveBalance(wsId: string, year: number | null) {
  return useQuery({
    queryKey: leaveKeys.balance(wsId, year ?? 0),
    queryFn: () => leaveApi.myBalance(wsId, year ?? 0),
    enabled: year !== null,
    staleTime: 30_000,
  });
}

/**
 * Xem trước số ngày khi người dùng đổi loại / ngày / buổi (debounce 400 ms — TL duyệt). Không gửi khi
 * khoảng ngày chưa hợp lệ (`draft = null`). Lỗi trả như khi gửi (vd không đủ phép) — form hiển thị câu.
 */
export function useLeavePreview(wsId: string, draft: Draft | null) {
  const debounced = useDebouncedValue(draft, 400);
  return useQuery({
    queryKey: leaveKeys.preview(wsId, debounced),
    queryFn: () => leaveApi.preview(wsId, debounced as Draft),
    enabled: debounced !== null,
    staleTime: 15_000,
    retry: false,
  });
}
