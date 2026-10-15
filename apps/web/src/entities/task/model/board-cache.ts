import { TASK_STATUS_ORDER, type TaskDto, type TaskStatus } from '@taskflow/contracts/task';

import { compareByRank } from '@/shared/lib/rank';

// Cache board chuẩn hóa theo id (frontend.md §3.2): merge một event chỉ thay một phần tử, các
// TaskDto khác giữ nguyên tham chiếu ⇒ React.memo(TaskCard) bỏ qua render. Cột được SUY RA.
// Mọi hàm ở đây thuần và trả lại đúng object cũ khi không có gì đổi (để Query không render lại).

export type BoardData = Readonly<{ byId: Readonly<Record<string, TaskDto>> }>;
export type BoardColumns = Readonly<Record<TaskStatus, readonly TaskDto[]>>;

export const EMPTY_BOARD: BoardData = { byId: {} };

export function boardFromTasks(tasks: readonly TaskDto[]): BoardData {
  return { byId: Object.fromEntries(tasks.map((t) => [t.id, t])) };
}

/** Ghi đè vô điều kiện (dùng cho optimistic và cho dữ liệu chắc chắn mới hơn). */
export function upsertTask(board: BoardData, task: TaskDto): BoardData {
  if (board.byId[task.id] === task) return board;
  return { byId: { ...board.byId, [task.id]: task } };
}

/** Chỉ nhận bản có `version` lớn hơn bản đang giữ (data-and-api §4.4-3). */
export function mergeIfNewer(board: BoardData, task: TaskDto): BoardData {
  const cached = board.byId[task.id];
  if (cached && task.version <= cached.version) return board;
  return upsertTask(board, task);
}

export function removeTask(board: BoardData, taskId: string): BoardData {
  if (!(taskId in board.byId)) return board;
  const { [taskId]: _removed, ...rest } = board.byId;
  return { byId: rest };
}

/**
 * Rollback THEO TỪNG TASK (frontend.md §4.4): chỉ đặt lại `base` khi chưa ai cập nhật task kể từ lúc
 * thao tác (`cached.version === base.version`); bản trong cache mới hơn ⇒ giữ. Task vắng mặt (xóa
 * optimistic thất bại) ⇒ hiện lại `base`.
 */
export function revertTask(board: BoardData, base: TaskDto): BoardData {
  const cached = board.byId[base.id];
  if (cached && cached.version !== base.version) return board;
  return upsertTask(board, base);
}

export function emptyColumns(): Record<TaskStatus, TaskDto[]> {
  return { TODO: [], IN_PROGRESS: [], REVIEW: [], DONE: [] };
}

/** Nhóm theo status, sắp theo (rank, id) so sánh code unit. */
export function toColumns(board: BoardData): BoardColumns {
  const columns = emptyColumns();
  for (const task of Object.values(board.byId)) columns[task.status].push(task);
  for (const status of TASK_STATUS_ORDER) columns[status].sort(compareByRank);
  return columns;
}
