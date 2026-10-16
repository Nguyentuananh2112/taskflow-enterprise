import { NotFoundDetails } from '@taskflow/contracts/common';
import type { QueryClient } from '@tanstack/react-query';

import { sessionKeys } from '@/entities/session/@x/workspace';
import { isApiError } from '@/shared/api';

import { workspaceKeys } from './query-keys';

export const WORKSPACE_GONE_MESSAGE = 'Bạn không còn truy cập được workspace này';

/**
 * 404 `workspace` từ một thao tác bên trong workspace: mình vừa bị xóa/hạ (X6), workspace đã bị xóa
 * (X7) — không lẫn với 404 `user` (người được thao tác không còn) (G1 W1).
 */
export function isWorkspaceGone(error: unknown): boolean {
  return (
    isApiError(error, 'RESOURCE_NOT_FOUND') &&
    NotFoundDetails.safeParse(error.details).data?.resource === 'workspace'
  );
}

/** Dọn cache khi không còn truy cập workspace (tự rời, bị xóa, workspace bị xóa). */
export function forgetWorkspace(client: QueryClient, wsId: string): void {
  client.removeQueries({ queryKey: workspaceKeys.root(wsId) });
  void client.invalidateQueries({ queryKey: workspaceKeys.list });
  void client.invalidateQueries({ queryKey: sessionKeys.me });
}
