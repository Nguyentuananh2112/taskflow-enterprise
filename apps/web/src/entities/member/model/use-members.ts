import { useInfiniteQuery } from '@tanstack/react-query';

import { memberApi } from '../api/member.api';
import { memberKeys } from './use-assignable-members';

/** Bảng thành viên: tìm `q` phía server, phân trang cursor (frontend.md §3.2). */
export function useMembers(wsId: string, q: string) {
  return useInfiniteQuery({
    queryKey: memberKeys.list(wsId, q),
    queryFn: ({ pageParam }) => memberApi.page(wsId, q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    staleTime: 60_000,
  });
}
