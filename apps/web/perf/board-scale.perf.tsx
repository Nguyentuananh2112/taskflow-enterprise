import type { TaskDto, TaskStatus } from '@taskflow/contracts/task';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { PROJECT_ID, USER_B, WS_ID, makeTask } from '@test/task-fixture';

import { boardFromTasks, taskKeys, updateBoard, useBoard } from '@/entities/task';
import { applyRealtimeEvent, parseTaskEvent } from '@/features/board-realtime';
import { LruSet } from '@/shared/lib/lru-set';
import { createQueryClient } from '@/shared/query';
import { KanbanBoard } from '@/widgets/kanban-board';

// Quy mô T-027 (perf/board-500): 1 cột × 500 và 4 cột × 500. Đo theo đường đi THẬT của
// use-board-realtime: parse Zod → updateBoard(applyRealtimeEvent) → React commit. Rebalance (T-033,
// tối đa 500 task/cột) phát N `task:moved` liên tiếp; socket giao mỗi event trong một macrotask riêng
// ⇒ mỗi event một lần commit. jsdom không có layout ⇒ số là CẬN TRÊN cho phần JS/React.
// Chạy: `pnpm --filter @taskflow/web test:perf` (không nằm trong `pnpm test`).

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
const scope = { wsId: WS_ID, projectId: PROJECT_ID };
const noop = () => undefined;
const OTHER_TAB = crypto.randomUUID(); // X-Client-Id của tab khác (envelope đòi Uuid)
const ms = (n: number) => Math.round(n * 10) / 10;
const rank = (prefix: string, i: number) => `${prefix}${String(i).padStart(4, '0')}`;

afterEach(() => cleanup());

function seed(columns: number, perColumn: number): TaskDto[] {
  return Array.from({ length: columns * perColumn }, (_, i) =>
    makeTask({
      status: STATUSES[i % columns] ?? 'TODO',
      rank: rank('a', Math.floor(i / columns)),
      title: `Task số ${i}`,
    }),
  );
}

/** Event thô như trên dây (để parse Zod như hook thật), do tab KHÁC gây ra. */
function movedEvent(task: TaskDto, to: { status: TaskStatus; rank: string }): unknown {
  const moved = { ...task, status: to.status, rank: to.rank, version: task.version + 1 };
  return {
    eventId: crypto.randomUUID(),
    type: 'task:moved',
    occurredAt: '2026-10-16T08:00:00.000Z',
    actorId: USER_B.id,
    originClientId: OTHER_TAB,
    data: { task: moved, from: { status: task.status, rank: task.rank }, to },
  };
}

function mountBoard(tasks: TaskDto[]) {
  const client = createQueryClient();
  client.setQueryData(taskKeys.board(WS_ID, PROJECT_ID), boardFromTasks(tasks));
  const commits: number[] = [];
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actual) => commits.push(actual);
  function Board() {
    const board = useBoard(scope);
    return board.data ? (
      <KanbanBoard scope={scope} board={board.data} canDrag onOpen={noop} />
    ) : null;
  }
  const t0 = performance.now();
  render(
    <QueryClientProvider client={client}>
      <Profiler id="board" onRender={onRender}>
        <Board />
      </Profiler>
    </QueryClientProvider>,
  );
  expect(screen.getAllByRole('article')).toHaveLength(tasks.length);
  const wall = performance.now() - t0;
  const ctx = { myClientId: 'me', seen: new LruSet<string>(500), tombstones: new Map() };
  /** Một event = một macrotask (như socket): parse + merge + chờ Query báo observer. */
  const deliver = async (raw: unknown) => {
    await act(async () => {
      const event = parseTaskEvent(raw);
      if (!event) throw new Error('event không hợp lệ');
      updateBoard(client, scope, (b) => applyRealtimeEvent(b, event, ctx));
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  /** Gom N event vào MỘT lần cập nhật (mô phỏng batch theo frame) — để so sánh. */
  const deliverBatch = async (raws: unknown[]) => {
    await act(async () => {
      const events = raws.map((raw) => parseTaskEvent(raw)).filter((e) => e !== null);
      updateBoard(client, scope, (b) =>
        events.reduce((acc, e) => applyRealtimeEvent(acc, e, ctx), b),
      );
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  return { commits, mountWall: wall, mount: commits[0] ?? NaN, deliver, deliverBatch };
}

const stats = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const sum = xs.reduce((s, x) => s + x, 0);
  return {
    sum,
    avg: sum / Math.max(1, xs.length),
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? NaN,
    max: sorted.at(-1) ?? NaN,
  };
};

async function scenario(label: string, columns: number, perColumn: number) {
  const tasks = seed(columns, perColumn);
  const b = mountBoard(tasks);
  const todo = tasks.filter((t) => t.status === 'TODO');
  const report: string[] = [
    `[perf] ${label}: mount ${ms(b.mount)}ms (tới DOM ${ms(b.mountWall)}ms)`,
  ];

  // 1 task:moved — TODO đầu sang cột khác (cột 1 cột: đổi vị trí trong cột).
  b.commits.length = 0;
  const first = todo[0]!;
  const target =
    columns > 1
      ? { status: 'IN_PROGRESS' as const, rank: 'zz' }
      : { status: 'TODO' as const, rank: 'zz' };
  let t0 = performance.now();
  await b.deliver(movedEvent(first, target));
  const one = { commit: stats(b.commits).sum, wall: performance.now() - t0 };
  report.push(`1 task:moved: commit ${ms(one.commit)}ms, wall ${ms(one.wall)}ms`);

  // Rebalance: mọi task còn lại của cột TODO nhận rank mới, cùng thứ tự — N event liên tiếp.
  const rest = todo.slice(1);
  const raws = rest.map((t, i) => movedEvent(t, { status: 'TODO', rank: rank('b', i) }));
  b.commits.length = 0;
  t0 = performance.now();
  for (const raw of raws) await b.deliver(raw);
  const seq = { ...stats(b.commits), wall: performance.now() - t0, n: raws.length };
  report.push(
    `rebalance ${seq.n} event lần lượt: wall ${ms(seq.wall)}ms (${ms(seq.wall / seq.n)}ms/event) · commit avg ${ms(seq.avg)} p95 ${ms(seq.p95)} max ${ms(seq.max)}ms`,
  );

  // Cùng N event nhưng gom một lần (rank 'c…') — cận dưới nếu batch theo frame.
  const raws2 = rest.map((t, i) =>
    movedEvent({ ...t, version: t.version + 1 }, { status: 'TODO', rank: rank('c', i) }),
  );
  b.commits.length = 0;
  t0 = performance.now();
  await b.deliverBatch(raws2);
  const batch = { commit: stats(b.commits).sum, wall: performance.now() - t0 };
  report.push(
    `gom ${raws2.length} event 1 lần: commit ${ms(batch.commit)}ms, wall ${ms(batch.wall)}ms`,
  );

  console.info(report.join(' · '));
  return { mount: b.mount, one, seq, batch };
}

describe('board quy mô T-027 (perf/board-500)', () => {
  it('1 cột × 500', async () => {
    const r = await scenario('1×500', 1, 500);
    // Chỉ khẳng định tính đúng (đã chạy hết); ngưỡng ms ghi ở báo cáo, không làm đỏ suite.
    expect(r.seq.n).toBe(499);
  }, 300_000);

  it('4 cột × 500 (2000 thẻ)', async () => {
    const r = await scenario('4×500', 4, 500);
    expect(r.seq.n).toBe(499);
  }, 600_000);
});
