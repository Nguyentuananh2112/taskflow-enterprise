'use client';

import { useSortable } from '@dnd-kit/react/sortable';
import type { TaskDto, TaskStatus } from '@taskflow/contracts/task';
import { memo } from 'react';

import { TaskCard } from '@/entities/task';
import { MoveMenu, type ColumnIds, type MoveIntent } from '@/features/task-move';

import type { CardData } from '../model/a11y-announcements';

type Props = Readonly<{
  task: TaskDto;
  /**
   * Cột ĐANG render thẻ — khác `task.status` trong lúc kéo (preview chỉ dời id). Là `group` của sortable
   * và `status` trong data: SortableKeyboardPlugin so `group` để biết thẻ đã sang cột mới (E2).
   */
  column: TaskStatus;
  index: number;
  /** Có quyền kéo (`task:move` && project chưa lưu trữ). */
  canDrag: boolean;
  /** Đang chờ server ⇒ khóa kéo (tránh 2 move cùng expectedVersion). */
  pending: boolean;
  /** Cột của thẻ đang bị chặn thả (state machine) trong lúc kéo thẻ khác. */
  blocked: boolean;
  reducedMotion: boolean;
  onOpen: (taskId: string) => void;
  getColumns: () => ColumnIds;
  onMove: (task: TaskDto, intent: MoveIntent) => void;
}>;

/** Bọc TaskCard bằng useSortable (frontend.md §4.1). Tay kéo là nút riêng ⇒ click tiêu đề vẫn mở drawer. */
export const SortableTaskCard = memo(function SortableTaskCard({
  task,
  column,
  index,
  canDrag,
  pending,
  blocked,
  reducedMotion,
  onOpen,
  getColumns,
  onMove,
}: Props) {
  const data: CardData = { status: column, key: task.key };
  const { ref, handleRef, isDragSource } = useSortable({
    id: task.id,
    index,
    group: column,
    type: 'task',
    accept: 'task',
    data,
    disabled: { draggable: !canDrag || pending, droppable: blocked },
    ...(reducedMotion ? { transition: null } : {}),
  });

  return (
    <li>
      <TaskCard
        // Không kéo được (VIEWER/lưu trữ) ⇒ không đăng ký phần tử: plugin Accessibility của dnd-kit
        // sẽ biến chính <article> thành role="button" khi không có tay kéo.
        ref={canDrag ? ref : undefined}
        task={task}
        onOpen={onOpen}
        pending={pending}
        dragging={isDragSource}
        handle={
          canDrag ? (
            <button
              type="button"
              ref={handleRef}
              disabled={pending}
              aria-label={`Kéo ${task.key}`}
              aria-roledescription="thẻ kéo được"
              className="inline-flex size-6 cursor-grab touch-none items-center justify-center rounded-control text-text-muted hover:bg-bg-subtle disabled:cursor-not-allowed"
            >
              <span aria-hidden="true">⠿</span>
            </button>
          ) : undefined
        }
        actions={
          canDrag ? <MoveMenu task={task} getColumns={getColumns} onMove={onMove} /> : undefined
        }
      />
    </li>
  );
});
