import { useMutation } from '@tanstack/react-query';

import { sessionKeys } from '@/entities/session';
import { workspaceApi, workspaceKeys } from '@/entities/workspace';

/** Xóa mềm (ADR-047): ẩn với mọi thành viên ngay, xóa vĩnh viễn sau 30 ngày, OWNER khôi phục được. */
export function useDeleteWorkspace(wsId: string) {
  return useMutation({
    mutationFn: (confirmSlug: string) => workspaceApi.remove(wsId, confirmSlug),
    onSuccess: (_deleted, _slug, _result, context) => {
      context.client.removeQueries({ queryKey: workspaceKeys.root(wsId) });
      for (const queryKey of [workspaceKeys.list, workspaceKeys.deleted, sessionKeys.me]) {
        void context.client.invalidateQueries({ queryKey });
      }
    },
  });
}
