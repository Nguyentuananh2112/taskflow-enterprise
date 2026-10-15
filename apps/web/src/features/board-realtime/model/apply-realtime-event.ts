import type {
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskMovedEvent,
  TaskUpdatedEvent,
} from '@taskflow/contracts/realtime';

import { removeTask, upsertTask, type BoardData } from '@/entities/task';
import type { LruSet } from '@/shared/lib/lru-set';

// Merge event `task:*` vào board cache (frontend.md §4.5, data-and-api §4.4) — hàm thuần, đúng
// thứ tự quy tắc. Không bao giờ refetch (ngoại lệ duy nhất: reconnect, xử lý ở hook).

export type TaskEvent = TaskCreatedEvent | TaskUpdatedEvent | TaskMovedEvent | TaskDeletedEvent;

export type RealtimeMergeContext = Readonly<{
  /** `X-Client-Id` của tab này — event do chính tab gây ra đã được response REST cập nhật. */
  myClientId: string;
  /** `eventId` gần đây (LRU ~500) — khử trùng lặp. */
  seen: LruSet<string>;
  /** taskId → version lúc xóa: chặn event cũ đến sau làm task "sống lại". */
  tombstones: Map<string, number>;
}>;

export function applyRealtimeEvent(
  board: BoardData,
  event: TaskEvent,
  ctx: RealtimeMergeContext,
): BoardData {
  // 1. Trùng lặp.
  if (ctx.seen.has(event.eventId)) return board;
  ctx.seen.add(event.eventId);
  // 2. Event của chính tab.
  if (event.originClientId === ctx.myClientId) return board;
  // 3. Xóa ⇒ bỏ khỏi board + tombstone.
  if (event.type === 'task:deleted') {
    const { taskId, version } = event.data;
    const cached = board.byId[taskId];
    if (cached && cached.version > version) return board;
    ctx.tombstones.set(taskId, Math.max(version, ctx.tombstones.get(taskId) ?? 0));
    return removeTask(board, taskId);
  }
  // 4. created / updated / moved: chỉ nhận bản mới hơn, không hồi sinh task đã xóa.
  const task = event.data.task;
  const tombstone = ctx.tombstones.get(task.id);
  if (tombstone !== undefined && tombstone >= task.version) return board;
  const cached = board.byId[task.id];
  if (cached && task.version <= cached.version) return board;
  return upsertTask(board, task);
}
