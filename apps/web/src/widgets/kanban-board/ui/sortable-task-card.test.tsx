import { DragDropProvider, useDragDropManager } from '@dnd-kit/react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeTask } from '@test/task-fixture';

import { SortableTaskCard } from './sortable-task-card';

// E2 (WCAG 2.1.1): kéo bằng bàn phím vào cột TRỐNG thả về cột cũ. Nguyên nhân: thẻ lấy `group` (và
// `data.status`) từ `task.status` — trong lúc kéo, preview dời thẻ sang cột mới nhưng `task.status` vẫn
// là cột gốc ⇒ SortableKeyboardPlugin tưởng thẻ chưa đổi nhóm, bật lại collision và thẻ bị kéo về.
// Cột có thẻ thì OptimisticSortingPlugin gán `group` hộ nên không lộ. Bằng chứng end-to-end: E2E-03 (F).

type Manager = NonNullable<ReturnType<typeof useDragDropManager>>;

function Probe({ onManager }: Readonly<{ onManager: (m: Manager) => void }>) {
  const manager = useDragDropManager();
  if (manager) onManager(manager);
  return null;
}

afterEach(() => cleanup());

describe('SortableTaskCard', () => {
  it('group + data.status theo CỘT đang render (preview), không theo task.status', () => {
    const task = makeTask({ status: 'TODO' });
    let manager: Manager | undefined;
    render(
      <DragDropProvider>
        <Probe onManager={(m) => (manager = m)} />
        <ul>
          <SortableTaskCard
            task={task}
            column="IN_PROGRESS"
            index={0}
            canDrag
            pending={false}
            blocked={false}
            reducedMotion
            onOpen={vi.fn()}
            getColumns={() => ({ TODO: [], IN_PROGRESS: [task.id], REVIEW: [], DONE: [] })}
            onMove={vi.fn()}
          />
        </ul>
      </DragDropProvider>,
    );
    const droppable = manager?.registry.droppables.get(task.id) as
      { sortable?: { group?: unknown }; data?: unknown } | undefined;
    expect(droppable?.sortable?.group).toBe('IN_PROGRESS');
    expect(droppable?.data).toMatchObject({ status: 'IN_PROGRESS', key: task.key });
  });
});
