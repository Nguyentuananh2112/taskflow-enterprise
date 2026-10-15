import type { TaskDto } from '@taskflow/contracts/task';
import { useMutation } from '@tanstack/react-query';

import {
  conflictCurrent,
  handleTaskWriteError,
  mergeIfNewer,
  taskApi,
  updateBoard,
  type TaskScope,
} from '@/entities/task';
import { isApiError } from '@/shared/api';

import { EditConflictError, conflictingFields, type TaskChanges } from './rebase';

export type UpdateVariables = Readonly<{
  /** Task lúc BẮT ĐẦU sửa — `expectedVersion` và gốc của rebase. */
  base: TaskDto;
  changes: TaskChanges;
}>;

/** PATCH + rebase 3 chiều (frontend.md §4.6): không xung đột ⇒ tự gửi lại đúng 1 lần. */
export async function sendUpdate(scope: TaskScope, { base, changes }: UpdateVariables) {
  try {
    return await taskApi.update(scope, base.id, { expectedVersion: base.version, ...changes });
  } catch (error) {
    const theirs = conflictCurrent(error);
    if (!theirs) throw error;
    const fields = conflictingFields(base, changes, theirs);
    if (fields.length > 0) throw new EditConflictError(theirs, fields);
    return taskApi.update(scope, base.id, { expectedVersion: theirs.version, ...changes });
  }
}

/**
 * `scope: task:<id>` (TanStack ≥ 5.31): các lần lưu liên tiếp của CÙNG task chạy tuần tự — lần sau
 * mang version cũ sẽ 409 với chính lần trước và được rebase tự gửi lại (xác định, không phụ thuộc mạng).
 */
export function useUpdateTask(scope: TaskScope, taskId: string) {
  return useMutation({
    scope: { id: `task:${taskId}` },
    mutationFn: (variables: UpdateVariables) => sendUpdate(scope, variables),
    onSuccess: (task, _variables, _result, context) => {
      updateBoard(context.client, scope, (board) => mergeIfNewer(board, task));
    },
    onError: (error, variables, _result, context) => {
      if (error instanceof EditConflictError) {
        // Board hiển thị bản mới nhất; form giữ giá trị của người dùng để họ quyết.
        updateBoard(context.client, scope, (board) => mergeIfNewer(board, error.theirs));
        return;
      }
      if (isApiError(error, 'VALIDATION_ERROR')) return; // form tự đổ lỗi vào field
      handleTaskWriteError(error, { client: context.client, scope, base: variables.base });
    },
  });
}
