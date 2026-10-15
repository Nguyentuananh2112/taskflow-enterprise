import { act, renderHook } from '@testing-library/react';
import type { TaskDto } from '@taskflow/contracts/task';
import { describe, expect, it, vi } from 'vitest';

import { makeTask } from '@test/task-fixture';

import { useBoardDnd } from './use-board-dnd';

// E2 hồi quy (F, E2E-02): CHUỘT kéo thẻ DUY NHẤT của "Cần làm" sang cột "Đang làm" TRỐNG. Chuỗi sự kiện
// dnd-kit phát ra: đích = droppable của cột ⇒ preview dời thẻ vào cột; frame sau collision chọn sortable
// của CHÍNH thẻ (ưu tiên cao hơn cột) ⇒ đích = thẻ, `data.status` = cột đang render. Kỳ vọng: vùng thả
// vẫn được đánh dấu (`over`), preview không bị kéo về, thả ⇒ onMove sang IN_PROGRESS.

type Handler = (event: unknown, manager: unknown) => void;
type Handlers = Record<'onDragStart' | 'onDragOver' | 'onDragEnd', Handler>;

const op = (source: unknown, target: unknown, canceled = false) => ({
  operation: { source, target, canceled },
  canceled,
  preventDefault: vi.fn(),
});

/** `move()` của @dnd-kit/helpers đọc vị trí con trỏ qua `source.manager` khi đích là một cột. */
const manager = { dragOperation: { shape: null, position: { current: { x: 0, y: 0 } } } };
const sourceOf = (task: TaskDto) => ({
  id: task.id,
  index: 0,
  initialIndex: 0,
  group: task.status,
  initialGroup: task.status,
  manager,
});

function setup(tasks: TaskDto[]) {
  const columns = {
    TODO: tasks.filter((t) => t.status === 'TODO'),
    IN_PROGRESS: tasks.filter((t) => t.status === 'IN_PROGRESS'),
    REVIEW: [],
    DONE: [],
  };
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const onMove = vi.fn();
  const hook = renderHook(() => useBoardDnd({ columns, byId, onMove }));
  const handlers = () => hook.result.current.handlers as unknown as Handlers;
  return { hook, handlers, onMove };
}

describe('useBoardDnd — chuột vào cột TRỐNG (E2)', () => {
  it('đích chuyển từ cột sang chính thẻ ⇒ vẫn "over" cột đích, preview giữ thẻ ở đó, thả ⇒ onMove', () => {
    const task = makeTask({ status: 'TODO' });
    const { hook, handlers, onMove } = setup([task]);
    const source = sourceOf(task);

    act(() => handlers().onDragStart(op(source, null), null));
    // 1) Con trỏ vào cột trống: đích = droppable của cột.
    act(() =>
      handlers().onDragOver(
        op(source, { id: 'IN_PROGRESS', data: { status: 'IN_PROGRESS' } }),
        null,
      ),
    );
    expect(hook.result.current.state.preview?.IN_PROGRESS).toEqual([task.id]);
    expect(hook.result.current.state.over).toBe('IN_PROGRESS');

    // 2) Thẻ đã render trong cột mới ⇒ collision chọn sortable của chính thẻ (group/status = cột render).
    const moved = { ...source, group: 'IN_PROGRESS' };
    act(() =>
      handlers().onDragOver(
        op(moved, { id: task.id, data: { status: 'IN_PROGRESS', key: task.key } }),
        null,
      ),
    );
    expect(hook.result.current.state.preview?.IN_PROGRESS).toEqual([task.id]);
    expect(hook.result.current.state.over).toBe('IN_PROGRESS');

    // 3) Thả.
    act(() =>
      handlers().onDragEnd(
        op(moved, { id: task.id, data: { status: 'IN_PROGRESS', key: task.key } }),
        null,
      ),
    );
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]?.[1]).toMatchObject({ status: 'IN_PROGRESS' });
    expect(hook.result.current.state.over).toBeNull();
  });

  it('đi ngang cột hợp lệ (trống) rồi thả trên cột BỊ CHẶN ⇒ không onMove (E2E-04)', () => {
    const task = makeTask({ status: 'TODO' });
    const { hook, handlers, onMove } = setup([task]);
    const source = sourceOf(task);
    act(() => handlers().onDragStart(op(source, null), null));
    act(() =>
      handlers().onDragOver(
        op(source, { id: 'IN_PROGRESS', data: { status: 'IN_PROGRESS' } }),
        null,
      ),
    );
    expect(hook.result.current.state.preview?.IN_PROGRESS).toEqual([task.id]);
    act(() => handlers().onDragOver(op(source, { id: 'DONE', data: { status: 'DONE' } }), null));
    act(() => handlers().onDragEnd(op(source, { id: 'DONE', data: { status: 'DONE' } }), null));
    expect(onMove).not.toHaveBeenCalled();
    expect(hook.result.current.state.preview).toBeNull(); // preview bỏ ⇒ board về dữ liệu thật
  });

  it('đi ngang cột hợp lệ rồi thả NGOÀI mọi đích (target null) ⇒ hủy, không onMove', () => {
    const task = makeTask({ status: 'TODO' });
    const { handlers, onMove } = setup([task]);
    const source = sourceOf(task);
    act(() => handlers().onDragStart(op(source, null), null));
    act(() =>
      handlers().onDragOver(
        op(source, { id: 'IN_PROGRESS', data: { status: 'IN_PROGRESS' } }),
        null,
      ),
    );
    act(() => handlers().onDragEnd(op(source, null), null));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('cột bị chặn (state machine) ⇒ không "over", không đổi preview', () => {
    const task = makeTask({ status: 'TODO' });
    const { hook, handlers } = setup([task]);
    const source = sourceOf(task);
    act(() => handlers().onDragStart(op(source, null), null));
    act(() => handlers().onDragOver(op(source, { id: 'DONE', data: { status: 'DONE' } }), null));
    expect(hook.result.current.state.over).toBeNull();
    expect(hook.result.current.state.preview?.TODO).toEqual([task.id]);
  });
});
