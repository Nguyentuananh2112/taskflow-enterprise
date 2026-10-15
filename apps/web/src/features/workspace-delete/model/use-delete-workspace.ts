import { useMutation } from '@tanstack/react-query';

import { sessionKeys } from '@/entities/session';
import { workspaceApi, workspaceKeys } from '@/entities/workspace';
import { isApiError } from '@/shared/api';

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
    onError: (error, _slug, _result, context) => {
      // Slug vừa bị đổi ở tab khác (400 mismatch / 409 version) ⇒ đọc lại để nhãn hiện slug mới.
      if (isApiError(error, 'VALIDATION_ERROR') || isApiError(error, 'VERSION_CONFLICT')) {
        void context.client.invalidateQueries({ queryKey: workspaceKeys.detail(wsId) });
      }
      // Đã bị xóa ở tab khác ⇒ dọn cache như khi xóa thành công.
      if (isApiError(error, 'RESOURCE_NOT_FOUND')) {
        context.client.removeQueries({ queryKey: workspaceKeys.root(wsId) });
        void context.client.invalidateQueries({ queryKey: workspaceKeys.list });
      }
    },
  });
}
