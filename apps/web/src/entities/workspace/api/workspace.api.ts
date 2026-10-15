import { WorkspaceDto } from '@taskflow/contracts/workspace';

import { http } from '@/shared/api';

export const workspaceApi = {
  get: (wsId: string) =>
    http.get(`/workspaces/${encodeURIComponent(wsId)}`, { schema: WorkspaceDto }),
};
