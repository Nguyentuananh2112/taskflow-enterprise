import type { TaskDto } from '@taskflow/contracts/task';
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';

import { taskApi, type TaskScope } from '../api/task.api';
import { boardFromTasks, type BoardData } from './board-cache';
import { taskKeys } from './query-keys';

/**
 * Board của project (frontend.md §3.2): `staleTime: Infinity` — giữ tươi bằng socket, refetch khi
 * reconnect/join lại; không refetch khi focus cửa sổ. Options dùng chung cho hook + prefetch (T-044 S3).
 */
export const boardQuery = (scope: TaskScope) =>
  queryOptions({
    queryKey: taskKeys.board(scope.wsId, scope.projectId),
    queryFn: async ({ signal }) => boardFromTasks(await taskApi.listAll(scope, signal)),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

export function useBoard(scope: TaskScope) {
  return useQuery(boardQuery(scope));
}

/**
 * Task cho drawer: đọc từ board cache; chỉ khi deep-link tới task chưa có trong board (board đã tải)
 * mới gọi `GET …/tasks/:taskId`.
 */
export function useTask(scope: TaskScope, taskId: string | null) {
  const board = useBoard(scope);
  const fromBoard = taskId ? board.data?.byId[taskId] : undefined;
  const needsFetch = taskId !== null && board.isSuccess && fromBoard === undefined;
  const detail = useQuery({
    queryKey: taskKeys.detail(scope.wsId, scope.projectId, taskId ?? ''),
    queryFn: () => taskApi.get(scope, taskId ?? ''),
    enabled: needsFetch,
    staleTime: Infinity,
  });
  return {
    task: fromBoard ?? (needsFetch ? detail.data : undefined),
    isPending: board.isPending || (needsFetch && detail.isPending),
    notFound: needsFetch && detail.isError,
  };
}

/** Sửa board cache (no-op khi board chưa tải). */
export function updateBoard(
  client: QueryClient,
  scope: TaskScope,
  fn: (board: BoardData) => BoardData,
): void {
  client.setQueryData<BoardData>(taskKeys.board(scope.wsId, scope.projectId), (old) =>
    old ? fn(old) : old,
  );
}

export function readBoardTask(
  client: QueryClient,
  scope: TaskScope,
  taskId: string,
): TaskDto | undefined {
  return client.getQueryData<BoardData>(taskKeys.board(scope.wsId, scope.projectId))?.byId[taskId];
}
