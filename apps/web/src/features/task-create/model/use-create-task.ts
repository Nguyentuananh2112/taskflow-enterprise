import type { CreateTaskBody } from '@taskflow/contracts/task';
import { useMutation } from '@tanstack/react-query';

import { mergeIfNewer, taskApi, updateBoard, type TaskScope } from '@/entities/task';

/**
 * Tạo task — luôn vào cuối cột Cần làm (R12). Response (có `originClientId` của tab này nên socket
 * bỏ qua event tương ứng) được ghi thẳng vào board.
 */
export function useCreateTask(scope: TaskScope) {
  return useMutation({
    mutationFn: (body: CreateTaskBody) => taskApi.create(scope, body),
    onSuccess: (task, _body, _result, context) => {
      updateBoard(context.client, scope, (board) => mergeIfNewer(board, task));
    },
  });
}
