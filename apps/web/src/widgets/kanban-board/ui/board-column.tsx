'use client';

import { useDroppable } from '@dnd-kit/react';
import type { TaskDto, TaskStatus } from '@taskflow/contracts/task';
import { memo } from 'react';

import { STATUS_LABEL } from '@/entities/task';
import type { ColumnIds, MoveIntent } from '@/features/task-move';
import { cn } from '@/shared/lib/cn';

import type { DropData } from '../model/use-board-dnd';
import { SortableTaskCard } from './sortable-task-card';

/** Ưu tiên va chạm thấp hơn thẻ (CollisionPriority.Low = 1 của @dnd-kit/abstract — gói gián tiếp). */
const COLUMN_COLLISION_PRIORITY = 1;

type Props = Readonly<{
  status: TaskStatus;
  tasks: readonly TaskDto[];
  /** Đang kéo thẻ từ cột `from` mà cột này không hợp lệ ⇒ mờ + ⊘ + không nhận thả. */
  blockedFrom: TaskStatus | null;
  canDrag: boolean;
  pendingIds: ReadonlySet<string>;
  reducedMotion: boolean;
  onOpen: (taskId: string) => void;
  getColumns: () => ColumnIds;
  onMove: (task: TaskDto, intent: MoveIntent) => void;
}>;

function BoardColumnImpl(props: Props) {
  const { status, tasks, blockedFrom, canDrag, pendingIds, reducedMotion } = props;
  const blocked = blockedFrom !== null;
  const data: DropData = { status };
  const { ref, isDropTarget } = useDroppable({
    id: status,
    type: 'column',
    accept: 'task',
    data,
    disabled: blocked,
    collisionPriority: COLUMN_COLLISION_PRIORITY,
  });
  const headingId = `column-${status}`;
  const reason = blocked
    ? `Không thể chuyển từ ${STATUS_LABEL[blockedFrom]} sang ${STATUS_LABEL[status]}`
    : undefined;

  return (
    <section
      ref={ref}
      aria-labelledby={headingId}
      title={reason}
      className={cn(
        'flex min-h-48 w-72 shrink-0 flex-col gap-2 rounded-card bg-bg-subtle p-2 transition-opacity',
        blocked && 'opacity-50',
        isDropTarget && 'ring-2 ring-primary',
      )}
    >
      <h2 id={headingId} className="flex items-center gap-2 px-1 text-xs font-semibold uppercase">
        <span>{STATUS_LABEL[status]}</span>
        <span className="font-normal text-text-muted">{tasks.length}</span>
        {blocked && (
          <span className="ml-auto" aria-hidden="true">
            ⊘
          </span>
        )}
      </h2>
      {reason && <p className="sr-only">{reason}</p>}
      <ul className="flex flex-1 flex-col gap-2">
        {tasks.map((task, index) => (
          <SortableTaskCard
            key={task.id}
            task={task}
            column={status}
            index={index}
            canDrag={canDrag}
            pending={pendingIds.has(task.id)}
            blocked={blocked}
            reducedMotion={reducedMotion}
            onOpen={props.onOpen}
            getColumns={props.getColumns}
            onMove={props.onMove}
          />
        ))}
      </ul>
      {tasks.length === 0 && (
        <p className="rounded-control border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
          {canDrag ? 'Thả task vào đây' : 'Chưa có task'}
        </p>
      )}
    </section>
  );
}

const sameTasks = (a: readonly TaskDto[], b: readonly TaskDto[]) =>
  a.length === b.length && a.every((task, i) => task === b[i]);

/** Memo theo mảng task (so sánh nông từng phần tử) — merge 1 event chỉ render lại 1 cột (§4.7). */
export const BoardColumn = memo(BoardColumnImpl, (prev, next) => {
  const { tasks: prevTasks, ...prevRest } = prev;
  const { tasks: nextTasks, ...nextRest } = next;
  return (
    sameTasks(prevTasks, nextTasks) &&
    (Object.keys(prevRest) as (keyof typeof prevRest)[]).every((k) => prevRest[k] === nextRest[k])
  );
});
