import { useQuery } from '@tanstack/react-query';

import { memberApi } from '../api/member.api';
import { memberKeys } from './use-assignable-members';

/** Ứng viên thêm vào workspace — chỉ gọi khi `q` ≥ 2 ký tự (server 400 nếu ngắn hơn). */
export function useMemberCandidates(wsId: string, q: string) {
  return useQuery({
    queryKey: memberKeys.candidates(wsId, q),
    queryFn: () => memberApi.candidates(wsId, q),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}
