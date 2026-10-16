import type { TaskDto } from '@taskflow/contracts/task';
import { describe, expect, it } from 'vitest';

import { PROJECT_ID, USER_A, WS_ID, makeTask } from '@test/task-fixture';

import { boardFromTasks, taskKeys, type BoardData } from '@/entities/task';
import { LruSet } from '@/shared/lib/lru-set';
import { createQueryClient } from '@/shared/query';

import {
  applyRealtimeEvent,
  type RealtimeMergeContext,
  type TaskEvent,
} from './apply-realtime-event';
import { createBoardEventSink } from './board-event-sink';

// perf/board-500 P1: gom cả lô vẫn giữ đúng quy tắc merge theo THỨ TỰ ĐẾN (frontend.md §4.5).

const ME = '0199e5a2-0000-7000-8000-00000000c1e1';
const OTHER_TAB = '0199e5a2-0000-7000-8000-00000000c1e2';
const scope = { wsId: WS_ID, projectId: PROJECT_ID };
const base = {
  occurredAt: '2026-10-16T08:00:00.000Z',
  actorId: USER_A.id,
  originClientId: OTHER_TAB,
};

const moved = (task: TaskDto, eventId: string = crypto.randomUUID()): TaskEvent => ({
  ...base,
  eventId,
  type: 'task:moved',
  data: { task, from: { status: 'TODO', rank: 'a' }, to: { status: task.status, rank: task.rank } },
});
const deleted = (task: TaskDto, version: number): TaskEvent => ({
  ...base,
  eventId: crypto.randomUUID(),
  type: 'task:deleted',
  data: { taskId: task.id, projectId: PROJECT_ID, key: task.key, version },
});
const newCtx = (): RealtimeMergeContext => ({
  myClientId: ME,
  seen: new LruSet(500),
  tombstones: new Map(),
});

function setup(tasks: TaskDto[]) {
  const queryClient = createQueryClient();
  queryClient.setQueryData(taskKeys.board(WS_ID, PROJECT_ID), boardFromTasks(tasks));
  let frame: (() => void) | undefined;
  const applied: Array<readonly TaskEvent[]> = [];
  const sink = createBoardEventSink({
    queryClient,
    scope,
    ctx: newCtx(),
    onApplied: (events) => applied.push(events),
    schedule: (run) => {
      frame = run;
      return () => (frame = undefined);
    },
  });
  const board = () => queryClient.getQueryData<BoardData>(taskKeys.board(WS_ID, PROJECT_ID));
  return { sink, board, applied, tick: () => frame?.() };
}

describe('createBoardEventSink', () => {
  it('cả lô ghi cache MỘT lần; chưa tới frame thì cache chưa đổi', () => {
    const t = makeTask({ version: 1, rank: 'a1' });
    const s = setup([t]);
    s.sink.push(moved({ ...t, status: 'DONE', rank: 'b', version: 2 }));
    expect(s.board()?.byId[t.id]?.status).toBe('TODO');
    s.tick();
    expect(s.board()?.byId[t.id]?.status).toBe('DONE');
    expect(s.applied).toHaveLength(1);
  });

  it('trong cùng lô: event version cũ đến SAU bản mới ⇒ bị bỏ (giữ bản mới)', () => {
    const t = makeTask({ version: 1, rank: 'a1' });
    const s = setup([t]);
    s.sink.push(moved({ ...t, status: 'DONE', rank: 'c', version: 3 }));
    s.sink.push(moved({ ...t, status: 'REVIEW', rank: 'b', version: 2 }));
    s.tick();
    expect(s.board()?.byId[t.id]).toMatchObject({ status: 'DONE', version: 3 });
  });

  it('trong cùng lô: xóa rồi event cũ hơn ⇒ không hồi sinh (tombstone); trùng eventId ⇒ áp 1 lần', () => {
    const a = makeTask({ version: 1, rank: 'a1' });
    const b = makeTask({ version: 1, rank: 'a2' });
    const s = setup([a, b]);
    s.sink.push(deleted(a, 2));
    s.sink.push(moved({ ...a, status: 'DONE', version: 2 }));
    const dup = moved({ ...b, status: 'REVIEW', rank: 'z', version: 2 });
    s.sink.push(dup);
    s.sink.push(moved({ ...b, status: 'DONE', version: 2 }, dup.eventId));
    s.tick();
    expect(s.board()?.byId[a.id]).toBeUndefined();
    expect(s.board()?.byId[b.id]).toMatchObject({ status: 'REVIEW', version: 2 });
    expect(s.applied[0]).toHaveLength(4);
  });

  it('rebalance 499 event (thứ tự trung gian xáo trộn) ⇒ kết quả giống hệt áp lần lượt', () => {
    const tasks = Array.from({ length: 500 }, (_, i) =>
      makeTask({ version: 1, rank: `a${String(i).padStart(4, '0')}` }),
    );
    const events = tasks
      .slice(1)
      .map((t, i) => moved({ ...t, rank: `b${String(498 - i).padStart(4, '0')}`, version: 2 }));
    const s = setup(tasks);
    events.forEach((e) => s.sink.push(e));
    s.tick();
    const ctx = newCtx();
    const sequential = events.reduce(
      (b, e) => applyRealtimeEvent(b, e, ctx),
      boardFromTasks(tasks),
    );
    expect(s.board()).toEqual(sequential);
    expect(s.applied).toHaveLength(1);
  });
});
