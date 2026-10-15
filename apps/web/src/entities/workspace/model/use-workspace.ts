import { useQuery } from '@tanstack/react-query';

import { workspaceApi } from '../api/workspace.api';
import { workspaceKeys } from './query-keys';

/** `WorkspaceDto` (có `myRole`) — cập nhật realtime qua `member:role-changed`. */
export function useWorkspace(wsId: string) {
  return useQuery({
    queryKey: workspaceKeys.detail(wsId),
    queryFn: () => workspaceApi.get(wsId),
    staleTime: 60_000,
  });
}
