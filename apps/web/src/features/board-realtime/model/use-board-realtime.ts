import type { ProjectDto } from '@taskflow/contracts/project';
import { ProjectUpdatedEvent, type TaskDeletedEvent } from '@taskflow/contracts/realtime';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { auditKeys } from '@/entities/audit-log';
import { projectKeys } from '@/entities/project';
import { boardSnapshotStartedAt, taskKeys, type TaskScope } from '@/entities/task';
import { LruSet } from '@/shared/lib/lru-set';
import { useRealtimeClient } from '@/shared/socket';

import type { RealtimeMergeContext, TaskEvent } from './apply-realtime-event';
import { createBoardEventSink } from './board-event-sink';
import { parseTaskEvent } from './parse-task-event';
import { isStaleProjectEvent } from './project-event-order';

const TASK_EVENTS = ['task:created', 'task:updated', 'task:moved', 'task:deleted'] as const;

/**
 * Snapshot board gửi trước lúc join phòng quá ngần này ⇒ refetch MỘT lần sau lần join đầu (T-044 S3, review E): event
 * trong khe "snapshot → join" không có replay. Dưới ngưỡng (điều hướng trong app: fetch và join cách nhau vài ms, như
 * trước T-044) ⇒ không tải lại. Hướng đúng hơn (việc sau): ack của project:join trả mốc phiên bản board.
 */
export const JOIN_SNAPSHOT_GAP_MS = 150;

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
    const boardKey = taskKeys.board(wsId, projectId);
    const cleanups: (() => void)[] = [];
    let firstJoin = true;
    /** Snapshot (đã về hoặc đang bay) gửi trước `joinStartedAt` quá ngưỡng ⇒ refetch một lần khi nó về. */
    const refreshIfSnapshotPredates = (joinStartedAt: number) => {
      const check = () => {
        const started = boardSnapshotStartedAt(boardScope);
        if (started !== undefined && joinStartedAt - started > JOIN_SNAPSHOT_GAP_MS) {
          void queryClient.invalidateQueries({ queryKey: boardKey, exact: true });
        }
      };
      const cache = queryClient.getQueryCache();
      const query = cache.find({ queryKey: boardKey, exact: true });
      if (query?.state.fetchStatus !== 'fetching') {
        check();
        return;
      }
      // Đang bay: KHÔNG hủy (giữ thẻ đầu sớm) — đợi nó về rồi mới quyết.
      const unsubscribe = cache.subscribe((event) => {
        if (event.query !== query || query.state.fetchStatus === 'fetching') return;
        unsubscribe();
        check();
      });
      cleanups.push(unsubscribe);
    };
    const join = () => {
      const joinStartedAt = Date.now();
      void client.joinProject({ workspaceId: wsId, projectId }).then((ack) => {
        if (!ack.ok) {
          if (ack.code === 'RESOURCE_NOT_FOUND') setNotFound(true);
          return;
        }
        if (!firstJoin) return; // join lại sau reconnect đã có invalidate riêng (onReconnect)
        firstJoin = false;
        refreshIfSnapshotPredates(joinStartedAt);
      });
    };
    // Gom theo frame (perf/board-500 P1): burst rebalance N `task:moved` ⇒ 1 lần ghi cache + 1 commit.
    const sink = createBoardEventSink({
      queryClient,
      scope: boardScope,
      ctx,
      onApplied: (events) => {
        const { openTaskId, onOpenTaskDeleted } = optionsRef.current;
        const touching = events.filter((e) => openTaskId !== null && eventTaskId(e) === openTaskId);
        if (openTaskId === null || touching.length === 0) return;
        void queryClient.invalidateQueries({
          queryKey: auditKeys.task({ wsId, projectId, taskId: openTaskId }),
        });
        const deleted = touching.find(
          (e) => e.type === 'task:deleted' && e.originClientId !== ctx.myClientId,
        );
        if (deleted?.type === 'task:deleted') onOpenTaskDeleted(deleted);
      },
    });
    const onTask = (raw: unknown) => {
      const event = parseTaskEvent(raw);
      if (event && eventProjectId(event) === projectId) sink.push(event);
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
        sink.flush();
        void queryClient.invalidateQueries({ queryKey: taskKeys.board(wsId, projectId) });
      }),
    ];
    if (client.status() === 'connected') join();
    return () => {
      offs.forEach((off) => off());
      cleanups.forEach((cleanup) => cleanup());
      sink.flush(); // board không tự refetch (staleTime Infinity) ⇒ không bỏ event đang chờ
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
