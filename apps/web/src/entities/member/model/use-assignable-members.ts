import { ROLE_RANK } from '@taskflow/contracts/rbac';
import { useQuery } from '@tanstack/react-query';

import { memberApi } from '../api/member.api';

/** Trang đầu đủ lớn cho picker (API tối đa 100/trang); gõ `q` để tìm người ngoài trang này. */
const PICKER_LIMIT = 100;

export const memberKeys = {
  all: (wsId: string) => ['ws', wsId, 'members'] as const,
  assignable: (wsId: string, q: string) => ['ws', wsId, 'members', 'assignable', { q }] as const,
};

/**
 * Người có thể được giao việc: role ≥ MEMBER (ADR-044 — VIEWER không xuất hiện trong picker).
 * Server vẫn là chốt chặn (`422 ASSIGNEE_NOT_MEMBER`).
 */
export function useAssignableMembers(wsId: string, q = '', enabled = true) {
  return useQuery({
    queryKey: memberKeys.assignable(wsId, q),
    queryFn: () => memberApi.list(wsId, { q, limit: PICKER_LIMIT }),
    select: (members) => members.filter((m) => ROLE_RANK[m.role] >= ROLE_RANK.MEMBER),
    staleTime: 60_000,
    enabled,
  });
}
