import { DragDropProvider } from '@dnd-kit/react';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeTask } from '@test/task-fixture';

import { BoardColumn } from '../ui/board-column';
import { FIRST_BATCH, useProgressiveLimit } from './use-progressive-limit';

// perf/board-mount bậc 3: mount dần. Trạng thái BAN ĐẦU kiểm bằng render tĩnh (không chạy effect —
// tất định); trong jsdom `act` xả hết transition nên test tích hợp chỉ thấy trạng thái CUỐI.

afterEach(() => cleanup());

function Probe({ longest }: Readonly<{ longest: number }>) {
  const limit = useProgressiveLimit(longest);
  return <output>{String(limit)}</output>;
}

describe('useProgressiveLimit', () => {
  it('render đầu: cột dài ⇒ FIRST_BATCH; board nhỏ ⇒ Infinity (không mount dần)', () => {
    expect(renderToStaticMarkup(<Probe longest={500} />)).toContain(`>${FIRST_BATCH}<`);
    expect(renderToStaticMarkup(<Probe longest={FIRST_BATCH} />)).toContain('>Infinity<');
  });

  it('sau các lô: chốt Infinity (thẻ mới về sau hiện ngay, không mount dần lại)', () => {
    const { rerender } = render(<Probe longest={500} />);
    expect(screen.getByRole('status').textContent).toBe('Infinity');
    rerender(<Probe longest={900} />);
    expect(screen.getByRole('status').textContent).toBe('Infinity');
  });
});

describe('BoardColumn khi đang mount dần', () => {
  it('tiêu đề đếm cả thẻ chưa mount; cột aria-busy; hết thẻ ẩn ⇒ bỏ aria-busy', () => {
    const tasks = Array.from({ length: 3 }, (_, i) => makeTask({ rank: `a${i}` }));
    const column = (hiddenCount: number) => (
      <DragDropProvider>
        <BoardColumn
          status="TODO"
          tasks={tasks}
          hiddenCount={hiddenCount}
          dragLocked={hiddenCount > 0}
          blockedFrom={null}
          isOver={false}
          canDrag
          pendingIds={new Set()}
          reducedMotion
          onOpen={vi.fn()}
          getColumns={() => ({ TODO: [], IN_PROGRESS: [], REVIEW: [], DONE: [] })}
          onMove={vi.fn()}
        />
      </DragDropProvider>
    );
    const { rerender } = render(column(97));
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading').textContent).toContain('100');
    expect(screen.getAllByRole('article')).toHaveLength(3);
    rerender(column(0));
    expect(screen.getByRole('region').getAttribute('aria-busy')).toBeNull();
    expect(screen.getByRole('heading').textContent).toContain('3');
  });
});
