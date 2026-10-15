import { useInfiniteQuery } from '@tanstack/react-query';

import { auditApi, type AuditScope } from '../api/audit.api';

export const auditKeys = {
  task: ({ wsId, projectId, taskId }: AuditScope) =>
    ['ws', wsId, 'project', projectId, 'task', taskId, 'audit'] as const,
};

/** Lịch sử task (cursor). `staleTime: 0` — invalidate khi có event realtime cho task đó (§3.2). */
export function useTaskAuditLogs(scope: AuditScope) {
  return useInfiniteQuery({
    queryKey: auditKeys.task(scope),
    queryFn: ({ pageParam }) => auditApi.list(scope, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    staleTime: 0,
  });
}
