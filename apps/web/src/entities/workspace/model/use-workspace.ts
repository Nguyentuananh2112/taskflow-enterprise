import { queryOptions, useQuery } from '@tanstack/react-query';

import { workspaceApi } from '../api/workspace.api';
import { workspaceKeys } from './query-keys';

/** `WorkspaceDto` (có `myRole`) — cập nhật realtime qua `member:role-changed`. Dùng chung với prefetch (T-044 S3). */
export const workspaceQuery = (wsId: string) =>
  queryOptions({
    queryKey: workspaceKeys.detail(wsId),
    queryFn: () => workspaceApi.get(wsId),
    staleTime: 60_000,
    // Header gọi `usePermission('')` ở trang không có workspace (/w, /account) ⇒ không gửi request rỗng.
    enabled: wsId !== '',
  });

export function useWorkspace(wsId: string) {
  return useQuery(workspaceQuery(wsId));
}
