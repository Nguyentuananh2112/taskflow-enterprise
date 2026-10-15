import type { TaskDto } from '@taskflow/contracts/task';
import { useMutation } from '@tanstack/react-query';

import {
  conflictCurrent,
  handleTaskWriteError,
  mergeIfNewer,
  removeTask,
  taskApi,
  taskKeys,
  updateBoard,
  type TaskScope,
} from '@/entities/task';

/**
 * Xóa task (ADR-022/045): ẩn thẻ ngay (optimistic), CÓ gửi `expectedVersion`. 409 ⇒ hiện lại thẻ bản
 * mới nhất và để UI hỏi "Vẫn xóa?" — không xóa mất thay đổi người khác vừa làm (frontend.md §4.4).
 */
export function useDeleteTask(scope: TaskScope) {
  return useMutation({
    mutationFn: ({ base }: Readonly<{ base: TaskDto }>) =>
      taskApi.remove(scope, base.id, base.version),
    onMutate: async ({ base }, context) => {
      await context.client.cancelQueries({ queryKey: taskKeys.board(scope.wsId, scope.projectId) });
      updateBoard(context.client, scope, (board) => removeTask(board, base.id));
    },
    onError: (error, { base }, _result, context) => {
      const current = conflictCurrent(error);
      if (current) {
        updateBoard(context.client, scope, (board) => mergeIfNewer(board, current));
        return;
      }
      handleTaskWriteError(error, { client: context.client, scope, base });
    },
  });
}
