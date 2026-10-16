import type { TaskStatus } from '@taskflow/contracts/task';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_ID, WS_ID, makeTask } from '@test/task-fixture';

import type * as EntitiesTask from '@/entities/task';
import { boardFromTasks, taskKeys, updateBoard, upsertTask, useBoard } from '@/entities/task';
import { createQueryClient } from '@/shared/query';
import { KanbanBoard } from '@/widgets/kanban-board';

// Hiệu năng board (frontend.md §4.7) kiểm bằng SỐ LẦN RENDER — tất định, không phụ thuộc tốc độ máy.
// Phép đo ms nằm ở perf/board.perf.tsx (chạy riêng). TaskCard được bọc để đếm mỗi lần thẻ render.

const renders = vi.hoisted(() => new Map<string, number>());

vi.mock('@/entities/task', async (importOriginal) => {
  const actual = await importOriginal<typeof EntitiesTask>();
  const { memo } = await import('react');
  // Bọc HÀM bên trong memo rồi memo lại bằng so sánh mặc định (như TaskCard thật) ⇒ đếm đúng số lần
  // TaskCard render, không phải số lần wrapper SortableTaskCard render.
  const Inner = (actual.TaskCard as unknown as { type: typeof actual.TaskCard }).type;
  function CountingTaskCard(props: ComponentProps<typeof actual.TaskCard>) {
    renders.set(props.task.id, (renders.get(props.task.id) ?? 0) + 1);
    return <Inner {...props} />;
  }
  return { ...actual, TaskCard: memo(CountingTaskCard) };
});

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
const scope = { wsId: WS_ID, projectId: PROJECT_ID };
const N = 24;

const stableOpen = () => undefined;

afterEach(() => cleanup());

function setup(onOpen: () => (taskId: string) => void, oneColumn = 0) {
  renders.clear();
  const tasks = oneColumn
    ? Array.from({ length: oneColumn }, (_, i) =>
        makeTask({ rank: `a${String(i).padStart(3, '0')}` }),
      )
    : Array.from({ length: N }, (_, i) =>
        makeTask({ status: STATUSES[i % 4] ?? 'TODO', rank: `a${String(i).padStart(3, '0')}` }),
      );
  const client = createQueryClient();
  client.setQueryData(taskKeys.board(WS_ID, PROJECT_ID), boardFromTasks(tasks));
  function Board() {
    const board = useBoard(scope);
    return board.data ? (
      <KanbanBoard scope={scope} board={board.data} canDrag onOpen={onOpen()} />
    ) : null;
  }
  render(
    <QueryClientProvider client={client}>
      <Board />
    </QueryClientProvider>,
  );
  const mergeOneEvent = async (title: string) => {
    const target = tasks[17];
    if (!target) throw new Error('thiếu task');
    await act(async () => {
      updateBoard(client, scope, (b) => upsertTask(b, { ...target, title, version: 9 }));
      await new Promise((r) => setTimeout(r, 0)); // notifyManager của Query là bất đồng bộ
    });
    return target;
  };
  /** Thẻ ĐẦU cột Cần làm sang cuối cột Đang làm ⇒ index của mọi thẻ còn lại trong cột dịch đi. */
  const moveFirstTodo = async () => {
    const target = tasks[0];
    if (!target) throw new Error('thiếu task');
    await act(async () => {
      updateBoard(client, scope, (b) =>
        upsertTask(b, { ...target, status: 'IN_PROGRESS', rank: 'zzz', version: 9 }),
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    return target;
  };
  return { tasks, mergeOneEvent, moveFirstTodo };
}

const snapshot = () => new Map(renders);
const changed = (before: Map<string, number>) =>
  [...renders].filter(([id, count]) => count !== before.get(id)).map(([id]) => id);

describe('board: merge 1 event chỉ render lại đúng 1 thẻ (memo theo tham chiếu task)', () => {
  it('mount: mỗi thẻ render đúng 1 lần', () => {
    setup(() => stableOpen);
    expect(screen.getAllByRole('article')).toHaveLength(N);
    expect(renders.size).toBe(N);
    expect([...renders.values()].every((count) => count === 1)).toBe(true);
  });

  it('event cập nhật 1 task ⇒ chỉ thẻ đó render lại', async () => {
    const { mergeOneEvent } = setup(() => stableOpen);
    const before = snapshot();
    const target = await mergeOneEvent('Đổi tên');
    expect(screen.getByRole('article', { name: 'Đổi tên' })).toBeTruthy();
    expect(changed(before)).toEqual([target.id]);
  });

  it('move 1 thẻ (dịch index cả cột) ⇒ chỉ TaskCard của thẻ đó render lại (perf/board-500 P2)', async () => {
    const { moveFirstTodo } = setup(() => stableOpen);
    const before = snapshot();
    const target = await moveFirstTodo();
    const inProgress = document.querySelector('section[aria-labelledby="column-IN_PROGRESS"]');
    expect(inProgress?.textContent).toContain(target.title);
    expect(changed(before)).toEqual([target.id]);
  });

  it('mount dần 150 thẻ một cột (bậc 3): cuối cùng đủ thẻ, hết "đang hiển thị thêm", mỗi TaskCard render ĐÚNG 1 lần', () => {
    setup(() => stableOpen, 150);
    expect(screen.getAllByRole('article')).toHaveLength(150);
    expect(screen.queryByText('Đang hiển thị thêm thẻ…')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect([...renders.values()].every((count) => count === 1)).toBe(true);
  });

  it('đối chứng: callback không ổn định (closure mới mỗi render) ⇒ MỌI thẻ render lại', async () => {
    const { mergeOneEvent } = setup(() => () => undefined);
    const before = snapshot();
    await mergeOneEvent('Đổi tên');
    expect(screen.getByRole('article', { name: 'Đổi tên' })).toBeTruthy();
    expect(changed(before)).toHaveLength(N);
  });
});
