import type { TaskStatus } from '@taskflow/contracts/task';

// Ý định di chuyển gửi lên server (frontend.md §4.3, data-and-api §2.7): KHÔNG gửi rank — server tự
// tính từ hàng xóm. `afterId` = task ngay trên, `beforeId` = task ngay dưới vị trí mới.

export type ColumnIds = Readonly<Record<TaskStatus, readonly string[]>>;

export type MoveIntent = Readonly<{
  /** Chỉ có khi đổi cột. */
  status?: TaskStatus;
  afterId: string | null;
  beforeId: string | null;
}>;

const STATUSES: readonly TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];

/** Id theo cột (đã sắp) — dạng `move()` của @dnd-kit/helpers nhận (mảng sửa được). */
export function toColumnIds(
  columns: Readonly<Record<TaskStatus, readonly { id: string }[]>>,
): Record<TaskStatus, string[]> {
  return {
    TODO: columns.TODO.map((t) => t.id),
    IN_PROGRESS: columns.IN_PROGRESS.map((t) => t.id),
    REVIEW: columns.REVIEW.map((t) => t.id),
    DONE: columns.DONE.map((t) => t.id),
  };
}

export function findColumn(columns: ColumnIds, taskId: string): TaskStatus | null {
  return STATUSES.find((s) => columns[s].includes(taskId)) ?? null;
}

const neighbors = (ids: readonly string[], taskId: string) => {
  const index = ids.indexOf(taskId);
  return { afterId: ids[index - 1] ?? null, beforeId: ids[index + 1] ?? null };
};

/**
 * So vị trí của `taskId` trong cột TRƯỚC và SAU khi thả. Không đổi gì ⇒ `null` (không gửi request).
 * Đang lọc: dùng hàng xóm HIỂN THỊ — server đặt ngay sau `afterId`, kết quả vẫn hợp lý (§4.3).
 */
export function computeMoveIntent(
  before: ColumnIds,
  after: ColumnIds,
  taskId: string,
): MoveIntent | null {
  const from = findColumn(before, taskId);
  const to = findColumn(after, taskId);
  if (from === null || to === null) return null;
  const next = neighbors(after[to], taskId);
  if (from === to) {
    const prev = neighbors(before[from], taskId);
    if (prev.afterId === next.afterId && prev.beforeId === next.beforeId) return null;
    return next;
  }
  return { status: to, ...next };
}

export type MoveTarget = Readonly<{ status: TaskStatus; edge: 'top' | 'bottom' }>;

/** Đường thay thế không cần kéo (SC 2.5.7): "Chuyển tới ▸ cột" (đặt cuối), "Lên đầu/Xuống cuối cột". */
export function intentToEdge(
  columns: ColumnIds,
  taskId: string,
  target: MoveTarget,
): MoveIntent | null {
  const from = findColumn(columns, taskId);
  if (from === null) return null;
  const others = columns[target.status].filter((id) => id !== taskId);
  const nextIds = target.edge === 'top' ? [taskId, ...others] : [...others, taskId];
  const after = { ...columns, [from]: columns[from].filter((id) => id !== taskId) };
  return computeMoveIntent(columns, { ...after, [target.status]: nextIds }, taskId);
}
