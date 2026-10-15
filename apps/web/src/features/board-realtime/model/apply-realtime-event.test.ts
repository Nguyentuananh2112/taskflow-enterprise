import type { TaskDto } from '@taskflow/contracts/task';
import { describe, expect, it } from 'vitest';

import { PROJECT_ID, USER_A, makeTask } from '@test/task-fixture';

import { boardFromTasks } from '@/entities/task';
import { LruSet } from '@/shared/lib/lru-set';

import {
  applyRealtimeEvent,
  type RealtimeMergeContext,
  type TaskEvent,
} from './apply-realtime-event';

// Quy tắc merge event (frontend.md §4.5 / data-and-api §4.4) — bắt buộc theo §8.1.

const ME = '0199e5a2-0000-7000-8000-00000000c1e1';
const OTHER_TAB = '0199e5a2-0000-7000-8000-00000000c1e2';

const ctx = (): RealtimeMergeContext => ({
  myClientId: ME,
  seen: new LruSet(500),
  tombstones: new Map(),
});

const envelope = { occurredAt: '2026-10-15T08:00:00.000Z', actorId: USER_A.id };

const updated = (task: TaskDto, origin: string | null = OTHER_TAB): TaskEvent => ({
  ...envelope,
  eventId: crypto.randomUUID(),
  type: 'task:updated',
  originClientId: origin,
  data: { task, changedFields: ['title'] },
});

const moved = (task: TaskDto): TaskEvent => ({
  ...envelope,
  eventId: crypto.randomUUID(),
  type: 'task:moved',
  originClientId: OTHER_TAB,
  data: {
    task,
    from: { status: 'TODO', rank: 'a0' },
    to: { status: task.status, rank: task.rank },
  },
});

const deleted = (task: TaskDto, version: number): TaskEvent => ({
  ...envelope,
  eventId: crypto.randomUUID(),
  type: 'task:deleted',
  originClientId: OTHER_TAB,
  data: { taskId: task.id, projectId: PROJECT_ID, key: task.key, version },
});

describe('applyRealtimeEvent', () => {
  const a = makeTask({ version: 2 });
  const b = makeTask();

  it('event mới hơn ghi đè; task khác giữ nguyên tham chiếu', () => {
    const board = boardFromTasks([a, b]);
    const next = applyRealtimeEvent(board, updated({ ...a, title: 'mới', version: 3 }), ctx());
    expect(next.byId[a.id]?.title).toBe('mới');
    expect(next.byId[b.id]).toBe(b);
  });

  it('version bằng hoặc cũ hơn ⇒ bỏ (trả đúng board cũ)', () => {
    const board = boardFromTasks([a]);
    expect(applyRealtimeEvent(board, updated({ ...a, version: 2 }), ctx())).toBe(board);
    expect(applyRealtimeEvent(board, updated({ ...a, version: 1 }), ctx())).toBe(board);
  });

  it('event do chính tab gây ra ⇒ bỏ (response REST đã cập nhật cache)', () => {
    const board = boardFromTasks([a]);
    expect(applyRealtimeEvent(board, updated({ ...a, version: 9 }, ME), ctx())).toBe(board);
  });

  it('trùng eventId ⇒ chỉ áp một lần', () => {
    const c = ctx();
    const event = updated({ ...a, version: 3 });
    const once = applyRealtimeEvent(boardFromTasks([a]), event, c);
    const resetBoard = boardFromTasks([a]);
    expect(applyRealtimeEvent(resetBoard, event, c)).toBe(resetBoard);
    expect(once.byId[a.id]?.version).toBe(3);
  });

  it('deleted rồi updated CŨ đến sau ⇒ không hồi sinh (tombstone)', () => {
    const c = ctx();
    const afterDelete = applyRealtimeEvent(boardFromTasks([a]), deleted(a, 3), c);
    expect(afterDelete.byId[a.id]).toBeUndefined();
    const late = applyRealtimeEvent(afterDelete, updated({ ...a, version: 3 }), c);
    expect(late).toBe(afterDelete);
  });

  it('created cho task đã có (trùng version) ⇒ bỏ; created mới ⇒ thêm', () => {
    const board = boardFromTasks([a]);
    const created = (task: TaskDto): TaskEvent => ({
      ...envelope,
      eventId: crypto.randomUUID(),
      type: 'task:created',
      originClientId: OTHER_TAB,
      data: { task },
    });
    expect(applyRealtimeEvent(board, created(a), ctx())).toBe(board);
    const fresh = makeTask();
    expect(applyRealtimeEvent(board, created(fresh), ctx()).byId[fresh.id]).toBe(fresh);
  });

  it('moved ⇒ task sang cột mới', () => {
    const next = applyRealtimeEvent(
      boardFromTasks([a]),
      moved({ ...a, status: 'IN_PROGRESS', version: 3 }),
      ctx(),
    );
    expect(next.byId[a.id]?.status).toBe('IN_PROGRESS');
  });

  it('deleted với version cũ hơn bản đang giữ ⇒ bỏ', () => {
    const board = boardFromTasks([{ ...a, version: 5 }]);
    expect(applyRealtimeEvent(board, deleted(a, 3), ctx())).toBe(board);
  });

  it('optimistic (giữ version cũ) bị event mới hơn của người khác ghi đè', () => {
    const optimistic = { ...a, status: 'IN_PROGRESS' as const, rank: 'b0' };
    const theirs = { ...a, title: 'người khác', version: 3 };
    const next = applyRealtimeEvent(boardFromTasks([optimistic]), updated(theirs), ctx());
    expect(next.byId[a.id]).toBe(theirs);
  });
});
