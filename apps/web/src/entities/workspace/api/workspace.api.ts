import {
  DeletedWorkspaceDto,
  WorkspaceDto,
  type CreateWorkspaceBody,
  type UpdateWorkspaceBody,
} from '@taskflow/contracts/workspace';
import * as z from 'zod';

import { http } from '@/shared/api';

// Workspace (data-and-api §2.5). Response parse bằng schema contracts trong `http`.

const one = (wsId: string) => `/workspaces/${encodeURIComponent(wsId)}`;

export const workspaceApi = {
  get: (wsId: string) => http.get(one(wsId), { schema: WorkspaceDto }),
  list: () => http.get('/workspaces', { schema: z.array(WorkspaceDto) }),
  /** Workspace đã xóa mềm mà tôi là OWNER, còn trong ân hạn 30 ngày (ADR-050). */
  listDeleted: () =>
    http.get('/workspaces', { schema: z.array(DeletedWorkspaceDto), query: { deleted: 'true' } }),
  create: (body: CreateWorkspaceBody) => http.post('/workspaces', { schema: WorkspaceDto, body }),
  update: (wsId: string, body: UpdateWorkspaceBody) =>
    http.patch(one(wsId), { schema: WorkspaceDto, body }),
  /** Xóa mềm — xác nhận bằng cách gõ lại slug (ADR-047). */
  remove: (wsId: string, confirmSlug: string) =>
    http.delete(one(wsId), { schema: DeletedWorkspaceDto, body: { confirmSlug } }),
  restore: (wsId: string) => http.post(`${one(wsId)}/restore`, { schema: WorkspaceDto }),
};
