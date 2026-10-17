import type { CorrectionStatus } from '@taskflow/contracts/attendance';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { correctionApi } from '../api/correction.api';
import { correctionKeys } from './query-keys';

const nextCursor = (last: {
  page?: { hasMore: boolean; nextCursor: string | null } | undefined;
}) => (last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined);

/** Đơn của mình, mới nhất trước — trang `/attendance` + nút trong chi tiết ngày đọc từ đây. */
export function useMyCorrections(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: correctionKeys.mine(),
    queryFn: ({ pageParam }) => correctionApi.mine(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled,
    staleTime: 30_000,
  });
}

export function useHrCorrections(status: CorrectionStatus | 'ALL') {
  return useInfiniteQuery({
    queryKey: correctionKeys.hr(status),
    queryFn: ({ pageParam }) =>
      correctionApi.list(status === 'ALL' ? undefined : status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    staleTime: 0,
  });
}

/** Số đơn chờ cho nhãn tab "Bổ sung giờ (3)"; trang đầu còn nữa ⇒ "50+". */
export function useHrPendingCorrectionCount(enabled: boolean) {
  return useQuery({
    queryKey: correctionKeys.hrPendingCount(),
    queryFn: () => correctionApi.list('PENDING'),
    select: (r) => ({ count: r.data.length, more: r.page?.hasMore ?? false }),
    enabled,
    staleTime: 30_000,
  });
}
