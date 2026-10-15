import type { TaskDto } from '@taskflow/contracts/task';
import { useMutation, useMutationState } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  conflictCurrent,
  handleTaskWriteError,
  mergeIfNewer,
  taskApi,
  taskKeys,
  tempRankBetween,
  updateBoard,
  upsertTask,
  type BoardData,
  type TaskScope,
} from '@/entities/task';
import { compareCodeUnits } from '@/shared/lib/rank';

import type { MoveIntent } from './compute-move-intent';

// Di chuyển task với optimistic update THEO TỪNG TASK (frontend.md §4.4).

export const MOVE_MUTATION_KEY = ['task', 'move'] as const;

export type MoveVariables = Readonly<{
  /** Task lúc thả — `expectedVersion` lấy từ đây, KHÔNG đọc lại cache lúc gửi (sẽ nuốt mất thay
   * đổi của người khác vừa đến qua socket ⇒ mất phát hiện xung đột). */
  base: TaskDto;
  intent: MoveIntent;
}>;

const body = (intent: MoveIntent, expectedVersion: number) => ({
  expectedVersion,
  ...(intent.status ? { status: intent.status } : {}),
  afterId: intent.afterId,
  beforeId: intent.beforeId,
});

/**
 * 409 mà người khác CHỈ sửa nội dung (status + rank y như lúc thả) ⇒ ý định kéo vẫn hợp lệ: tự gửi
 * lại đúng 1 lần với version mới. Ngược lại ném để onError đưa task về vị trí thật (§4.4).
 */
export async function sendMove(scope: TaskScope, { base, intent }: MoveVariables) {
  try {
    return await taskApi.move(scope, base.id, body(intent, base.version));
  } catch (error) {
    const current = conflictCurrent(error);
    if (!current || current.status !== base.status || current.rank !== base.rank) throw error;
    return taskApi.move(scope, base.id, body(intent, current.version));
  }
}

/** Bản optimistic: đổi cột + rank tạm, GIỮ version cũ (event mới hơn của người khác sẽ thắng). */
export function optimisticTask(board: BoardData, { base, intent }: MoveVariables): TaskDto {
  const status = intent.status ?? base.status;
  const rankOf = (id: string | null) => (id ? (board.byId[id]?.rank ?? null) : null);
  const between = tempRankBetween(rankOf(intent.afterId), rankOf(intent.beforeId));
  if (between) return { ...base, status, rank: between };
  // Hàng xóm lệch (dữ liệu cũ) ⇒ chỉ đổi cột + đặt cuối; server trả rank thật ngay sau đó.
  const last = Object.values(board.byId)
    .filter((t) => t.status === status && t.id !== base.id)
    .map((t) => t.rank)
    .sort(compareCodeUnits)
    .at(-1);
  return { ...base, status, rank: tempRankBetween(last ?? null, null) ?? base.rank };
}

export function useMoveTask(scope: TaskScope) {
  return useMutation({
    mutationKey: MOVE_MUTATION_KEY,
    mutationFn: (variables: MoveVariables) => sendMove(scope, variables),
    onMutate: async (variables, context) => {
      await context.client.cancelQueries({ queryKey: taskKeys.board(scope.wsId, scope.projectId) });
      updateBoard(context.client, scope, (board) =>
        upsertTask(board, optimisticTask(board, variables)),
      );
    },
    onSuccess: (task, _variables, _result, context) => {
      updateBoard(context.client, scope, (board) => mergeIfNewer(board, task));
    },
    onError: (error, variables, _result, context) => {
      handleTaskWriteError(error, { client: context.client, scope, base: variables.base });
    },
  });
}

/** Id các task đang chờ move — khóa kéo thẻ đó (tránh 2 move cùng `expectedVersion` — §4.2). */
export function usePendingMoveIds(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { mutationKey: MOVE_MUTATION_KEY, status: 'pending' },
    select: (mutation) => (mutation.state.variables as MoveVariables | undefined)?.base.id ?? '',
  });
  return useMemo(() => new Set(ids.filter((id) => id !== '')), [ids]);
}
