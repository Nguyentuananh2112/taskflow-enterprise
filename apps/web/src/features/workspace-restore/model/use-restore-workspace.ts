import { useMutation } from '@tanstack/react-query';

import { sessionKeys } from '@/entities/session';
import { workspaceApi, workspaceKeys } from '@/entities/workspace';

/** POST …/restore (ADR-050) — 404 một kiểu cho mọi thất bại (quá hạn, đã purge, không phải OWNER). */
export function useRestoreWorkspace() {
  return useMutation({
    mutationFn: (wsId: string) => workspaceApi.restore(wsId),
    onSettled: (_data, _error, _wsId, _result, context) => {
      for (const queryKey of [workspaceKeys.list, workspaceKeys.deleted, sessionKeys.me]) {
        void context.client.invalidateQueries({ queryKey });
      }
    },
  });
}
