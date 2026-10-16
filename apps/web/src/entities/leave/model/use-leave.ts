import { useQuery } from '@tanstack/react-query';

import { leaveApi } from '../api/leave.api';

// Dưới gốc ['ws', wsId] ⇒ mất quyền workspace dọn luôn (frontend.md §3.2).
export const leaveKeys = {
  all: (wsId: string) => ['ws', wsId, 'leave'] as const,
  mine: (wsId: string) => ['ws', wsId, 'leave', 'mine'] as const,
  balance: (wsId: string, year: number) => ['ws', wsId, 'leave', 'balance', year] as const,
};

export function useMyLeaveRequests(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: leaveKeys.mine(wsId),
    queryFn: async () => (await leaveApi.mine(wsId)).data,
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
