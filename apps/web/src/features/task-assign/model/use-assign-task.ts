import { BusinessRuleDetails } from '@taskflow/contracts/common';
import type { TaskDto } from '@taskflow/contracts/task';
import { useMutation } from '@tanstack/react-query';

import { memberKeys } from '@/entities/member';
import {
  conflictCurrent,
  handleTaskWriteError,
  mergeIfNewer,
  taskApi,
  updateBoard,
  type TaskScope,
} from '@/entities/task';
import { isApiError } from '@/shared/api';
import { toast } from '@/shared/ui/toast';

export type AssignVariables = Readonly<{ base: TaskDto; assigneeId: string | null }>;

/** 409 mà người khác không đổi người phụ trách ⇒ ý định gán vẫn hợp lệ: tự gửi lại 1 lần (§4.6). */
export async function sendAssign(scope: TaskScope, { base, assigneeId }: AssignVariables) {
  try {
    return await taskApi.assign(scope, base.id, { expectedVersion: base.version, assigneeId });
  } catch (error) {
    const theirs = conflictCurrent(error);
    if (!theirs || (theirs.assignee?.id ?? null) !== (base.assignee?.id ?? null)) throw error;
    return taskApi.assign(scope, base.id, { expectedVersion: theirs.version, assigneeId });
  }
}

const isAssigneeRejected = (error: unknown) =>
  isApiError(error, 'BUSINESS_RULE_VIOLATION') &&
  BusinessRuleDetails.safeParse(error.details).data?.rule === 'ASSIGNEE_NOT_MEMBER';

export function useAssignTask(scope: TaskScope, taskId: string) {
  return useMutation({
    scope: { id: `task:${taskId}` },
    mutationFn: (variables: AssignVariables) => sendAssign(scope, variables),
    onSuccess: (task, _variables, _result, context) => {
      updateBoard(context.client, scope, (board) => mergeIfNewer(board, task));
    },
    onError: (error, variables, _result, context) => {
      if (isAssigneeRejected(error)) {
        // ADR-044: người nhận vừa bị hạ VIEWER / rời workspace — làm mới danh sách chọn.
        void context.client.invalidateQueries({ queryKey: memberKeys.all(scope.wsId) });
        toast({ title: 'Người này không còn được giao việc', tone: 'error' });
        return;
      }
      handleTaskWriteError(error, { client: context.client, scope, base: variables.base });
    },
  });
}
