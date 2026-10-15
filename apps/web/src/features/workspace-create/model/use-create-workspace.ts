import type { CreateWorkspaceBody } from '@taskflow/contracts/workspace';
import { useMutation } from '@tanstack/react-query';

import { sessionKeys } from '@/entities/session';
import { workspaceApi, workspaceKeys } from '@/entities/workspace';

/** POST /workspaces — người tạo là OWNER; slug trống ⇒ server tự sinh từ tên (R19). */
export function useCreateWorkspace() {
  return useMutation({
    mutationFn: (body: CreateWorkspaceBody) => workspaceApi.create(body),
    onSuccess: (workspace, _body, _result, context) => {
      context.client.setQueryData(workspaceKeys.detail(workspace.id), workspace);
      void context.client.invalidateQueries({ queryKey: workspaceKeys.list });
      void context.client.invalidateQueries({ queryKey: sessionKeys.me });
    },
  });
}
