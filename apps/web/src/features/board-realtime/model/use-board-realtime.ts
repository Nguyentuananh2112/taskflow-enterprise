import type { ProjectDto } from '@taskflow/contracts/project';
import { ProjectUpdatedEvent, type TaskDeletedEvent } from '@taskflow/contracts/realtime';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { auditKeys } from '@/entities/audit-log';
import { projectKeys } from '@/entities/project';
import { taskKeys, updateBoard, type TaskScope } from '@/entities/task';
import { LruSet } from '@/shared/lib/lru-set';
import { useRealtimeClient } from '@/shared/socket';

import {
  applyRealtimeEvent,
  type RealtimeMergeContext,
  type TaskEvent,
} from './apply-realtime-event';
import { parseTaskEvent } from './parse-task-event';
import { isStaleProjectEvent } from './project-event-order';

const TASK_EVENTS = ['task:created', 'task:updated', 'task:moved', 'task:deleted'] as const;

type Options = Readonly<{
  /** Task đang mở trong drawer — event chạm nó ⇒ làm mới lịch sử; bị xóa ⇒ `onOpenTaskDeleted`. */
  openTaskId: string | null;
  onOpenTaskDeleted: (event: TaskDeletedEvent) => void;
}>;

/**
 * Realtime của board (frontend.md §4.5): `project:join` khi mở, `project:leave` khi rời; merge
 * `task:*` vào cache theo version; `project:updated` ghi vào project; reconnect ⇒ join lại + refetch
 * board MỘT lần (không có replay ở v1.1). Trả `notFound` khi join bị từ chối (404 như REST).
 */
export function useBoardRealtime(scope: TaskScope, options: Options) {
  const client = useRealtimeClient();
  const queryClient = useQueryClient();
  const [notFound, setNotFound] = useState(false);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  // Giữ qua refetch (rẻ, chặn event trễ) nhưng riêng cho mỗi board.
  const [merge] = useState<RealtimeMergeContext>(() => ({
    myClientId: client.clientId,
    seen: new LruSet<string>(500),
    tombstones: new Map(),
  }));

  const { wsId, projectId } = scope;
  useEffect(() => {
    const ctx = { ...merge, myClientId: client.clientId };
    const boardScope = { wsId, projectId };
    const join = () =>
      void client.joinProject({ workspaceId: wsId, projectId }).then((ack) => {
        if (!ack.ok && ack.code === 'RESOURCE_NOT_FOUND') setNotFound(true);
      });
    const onTask = (raw: unknown) => {
      const event = parseTaskEvent(raw);
      if (!event || eventProjectId(event) !== projectId) return;
      updateBoard(queryClient, boardScope, (board) => applyRealtimeEvent(board, event, ctx));
      const { openTaskId, onOpenTaskDeleted } = optionsRef.current;
      if (openTaskId === null || eventTaskId(event) !== openTaskId) return;
      void queryClient.invalidateQueries({
        queryKey: auditKeys.task({ wsId, projectId, taskId: openTaskId }),
      });
      if (event.type === 'task:deleted' && event.originClientId !== ctx.myClientId) {
        onOpenTaskDeleted(event);
      }
    };
    const offs = [
      ...TASK_EVENTS.map((name) => client.on(name, onTask)),
      client.on('project:updated', (raw) => {
        const event = ProjectUpdatedEvent.safeParse(raw);
        if (!event.success || event.data.data.project.id !== projectId) return;
        const incoming = event.data.data.project;
        queryClient.setQueryData<ProjectDto>(projectKeys.detail(wsId, projectId), (cached) =>
          isStaleProjectEvent(cached, incoming) ? cached : incoming,
        );
      }),
      client.onStatus((status) => {
        if (status === 'connected') join();
      }),
      client.onReconnect(() => {
        void queryClient.invalidateQueries({ queryKey: taskKeys.board(wsId, projectId) });
      }),
    ];
    if (client.status() === 'connected') join();
    return () => {
      offs.forEach((off) => off());
      if (client.status() === 'connected') void client.leaveProject({ projectId });
    };
  }, [client, queryClient, merge, wsId, projectId]);

  return { notFound };
}

function eventProjectId(event: TaskEvent): string {
  return event.type === 'task:deleted' ? event.data.projectId : event.data.task.projectId;
}

function eventTaskId(event: TaskEvent): string {
  return event.type === 'task:deleted' ? event.data.taskId : event.data.task.id;
}
