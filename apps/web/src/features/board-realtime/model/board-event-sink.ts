import type { QueryClient } from '@tanstack/react-query';

import { updateBoard, type TaskScope } from '@/entities/task';

import {
  applyRealtimeEvent,
  type RealtimeMergeContext,
  type TaskEvent,
} from './apply-realtime-event';
import { createFrameBatcher, type Schedule } from './frame-batcher';

/**
 * Event `task:*` đã parse ⇒ gom theo frame ⇒ MỘT `updateBoard` reduce TUẦN TỰ qua
 * `applyRealtimeEvent` (giữ nguyên dedupe / origin / tombstone / version theo thứ tự đến).
 * `onApplied` nhận cả lô sau khi ghi cache (drawer: lịch sử, task đang mở bị xóa).
 */
export function createBoardEventSink(
  deps: Readonly<{
    queryClient: QueryClient;
    scope: TaskScope;
    ctx: RealtimeMergeContext;
    onApplied?: (events: readonly TaskEvent[]) => void;
    schedule?: Schedule;
  }>,
) {
  const { queryClient, scope, ctx, onApplied } = deps;
  return createFrameBatcher<TaskEvent>((events) => {
    updateBoard(queryClient, scope, (board) =>
      events.reduce((acc, event) => applyRealtimeEvent(acc, event, ctx), board),
    );
    onApplied?.(events);
  }, deps.schedule);
}
