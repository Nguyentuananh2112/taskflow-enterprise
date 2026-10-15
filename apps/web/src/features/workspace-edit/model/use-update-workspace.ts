import type { UpdateWorkspaceBody } from '@taskflow/contracts/workspace';
import { useMutation } from '@tanstack/react-query';

import { sessionKeys } from '@/entities/session';
import { workspaceApi, workspaceKeys } from '@/entities/workspace';

export function useUpdateWorkspace(wsId: string) {
  return useMutation({
    mutationFn: (body: UpdateWorkspaceBody) => workspaceApi.update(wsId, body),
    onSuccess: (workspace, _body, _result, context) => {
      context.client.setQueryData(workspaceKeys.detail(wsId), workspace);
      void context.client.invalidateQueries({ queryKey: workspaceKeys.list });
      void context.client.invalidateQueries({ queryKey: sessionKeys.me }); // tên hiển thị ở /w
    },
  });
}
