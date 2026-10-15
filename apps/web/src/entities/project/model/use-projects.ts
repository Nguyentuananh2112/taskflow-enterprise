import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { projectApi, type ProjectListFilter } from '../api/project.api';

export const projectKeys = {
  list: (wsId: string, archived: ProjectListFilter) =>
    ['ws', wsId, 'projects', { archived }] as const,
  detail: (wsId: string, projectId: string) => ['ws', wsId, 'project', projectId] as const,
};

/** Danh sách project (frontend.md §3.2: infinite theo cursor). */
export function useProjects(wsId: string, archived: ProjectListFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: projectKeys.list(wsId, archived),
    queryFn: ({ pageParam }) => projectApi.list(wsId, archived, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    staleTime: 60_000,
    enabled,
  });
}

/** Project của board — `project:updated` qua socket ghi thẳng vào key này. */
export function useProject(wsId: string, projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(wsId, projectId),
    queryFn: () => projectApi.get(wsId, projectId),
    staleTime: 60_000,
  });
}
