import { queryOptions, useQuery } from '@tanstack/react-query';

import { workspaceApi } from '../api/workspace.api';
import { workspaceKeys } from './query-keys';

/** Workspace của tôi (không phân trang — tối đa 100/user, data-and-api §2.5). Dùng chung với prefetch (T-044 S3). */
export const workspacesQuery = () =>
  queryOptions({ queryKey: workspaceKeys.list, queryFn: workspaceApi.list, staleTime: 60_000 });

export function useWorkspaces() {
  return useQuery(workspacesQuery());
}

/** Khu "Đã xóa — khôi phục được" (chỉ có dữ liệu khi tôi là OWNER). */
export function useDeletedWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.deleted,
    queryFn: workspaceApi.listDeleted,
    staleTime: 60_000,
  });
}
