import type { UpdateWorkspaceBody } from '@taskflow/contracts/workspace';
import { useMutation } from '@tanstack/react-query';

import { sessionKeys } from '@/entities/session';
import { workspaceApi, workspaceKeys } from '@/entities/workspace';
import { isApiError } from '@/shared/api';

export function useUpdateWorkspace(wsId: string) {
  return useMutation({
    mutationFn: (body: UpdateWorkspaceBody) => workspaceApi.update(wsId, body),
    onSuccess: (workspace, _body, _result, context) => {
      context.client.setQueryData(workspaceKeys.detail(wsId), workspace);
      void context.client.invalidateQueries({ queryKey: workspaceKeys.list });
      void context.client.invalidateQueries({ queryKey: sessionKeys.me }); // tên hiển thị ở /w
    },
    // Bản đang hiển thị đã cũ (ghi đồng thời — ADR-110; bị xóa ở tab khác) ⇒ đọc lại (G1 W3).
    onError: (error, _body, _result, context) => {
      if (isApiError(error, 'VERSION_CONFLICT') || isApiError(error, 'RESOURCE_NOT_FOUND')) {
        void context.client.invalidateQueries({ queryKey: workspaceKeys.detail(wsId) });
      }
    },
  });
}
