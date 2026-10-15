import type { TaskStatus } from '@taskflow/contracts/task';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { describe, expect, it } from 'vitest';

import { PROJECT_ID, WS_ID, makeTask } from '@test/task-fixture';

import {
  boardFromTasks,
  taskKeys,
  toColumns,
  updateBoard,
  upsertTask,
  useBoard,
} from '@/entities/task';
import { applyRealtimeEvent } from '@/features/board-realtime';
import { LruSet } from '@/shared/lib/lru-set';
import { createQueryClient } from '@/shared/query';
import { KanbanBoard } from '@/widgets/kanban-board';

// Đo ms theo ngân sách §4.7 (board 500 task; merge 1 event < 4ms). CHẠY RIÊNG: `pnpm --filter
// @taskflow/web test:perf` — không nằm trong `pnpm test` vì ngưỡng tuyệt đối phụ thuộc tốc độ máy.
// jsdom chậm hơn trình duyệt thật và không có layout ⇒ số ở đây là CẬN TRÊN cho phần JS/React.

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
const scope = { wsId: WS_ID, projectId: PROJECT_ID };

function seed500() {
  return Array.from({ length: 500 }, (_, i) =>
    makeTask({
      status: STATUSES[i % 4] ?? 'TODO',
      rank: `a${String(i).padStart(4, '0')}`,
      title: `Task số ${i}`,
    }),
  );
}

const noop = () => undefined;
const ms = (n: number) => Math.round(n * 100) / 100;

describe('hiệu năng board 500 task', () => {
  it('merge 1 event + suy cột: trung bình < 4ms', () => {
    const tasks = seed500();
    const board = boardFromTasks(tasks);
    const ctx = { myClientId: 'me', seen: new LruSet<string>(500), tombstones: new Map() };
    const target = tasks[123]!;
    const runs = 200;
    let t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      applyRealtimeEvent(
        board,
        {
          eventId: crypto.randomUUID(),
          type: 'task:updated',
          occurredAt: '2026-10-15T08:00:00.000Z',
          actorId: target.createdBy!.id,
          originClientId: null,
          data: { task: { ...target, version: target.version + 1 + i }, changedFields: ['title'] },
        },
        ctx,
      );
    }
    const merge = (performance.now() - t0) / runs;
    t0 = performance.now();
    for (let i = 0; i < 50; i++) toColumns(board);
    const columns = (performance.now() - t0) / 50;
    console.info(
      `[perf] applyRealtimeEvent: ${ms(merge)}ms/event · toColumns(500): ${ms(columns)}ms`,
    );
    expect(merge + columns).toBeLessThan(4);
  });

  it('render lần đầu 500 thẻ và commit khi 1 event đến (React Profiler, jsdom)', async () => {
    const client = createQueryClient();
    const tasks = seed500();
    client.setQueryData(taskKeys.board(WS_ID, PROJECT_ID), boardFromTasks(tasks));
    const commits: Array<{ phase: string; duration: number }> = [];
    const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) =>
      commits.push({ phase, duration: actualDuration });
    function Board() {
      const board = useBoard(scope);
      // Callback ổn định như BoardPage (useCallback) — closure mới mỗi render sẽ phá memo mọi thẻ.
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
    expect(screen.getAllByRole('article')).toHaveLength(500);
    const firstRender = performance.now() - t0;
    const mount = commits.find((c) => c.phase === 'mount')?.duration ?? NaN;

    commits.length = 0;
    const target = tasks[321]!;
    // Query thông báo observer qua notifyManager (bất đồng bộ) ⇒ act async.
    await act(async () => {
      updateBoard(client, scope, (b) => upsertTask(b, { ...target, title: 'Đổi tên', version: 9 }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole('article', { name: 'Đổi tên' })).toBeTruthy();
    const update = commits.reduce((sum, c) => sum + c.duration, 0);
    console.info(
      `[perf] mount 500 thẻ: ${ms(mount)}ms (tổng tới DOM ${ms(firstRender)}ms) · commit 1 event: ${ms(update)}ms`,
    );
    // Memo theo tham chiếu task: cập nhật 1 task phải rẻ hơn hẳn mount cả board.
    expect(update).toBeLessThan(mount / 5);
  });
});
