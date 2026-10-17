import type { TaskDto } from '@taskflow/contracts/task';
import { memo, type ReactNode, type Ref } from 'react';

import { cn } from '@/shared/lib/cn';
import { Avatar } from '@/shared/ui/avatar';
import { Spinner } from '@/shared/ui/spinner';

import { DueDate } from './due-date';
import { PriorityBadge } from './priority-badge';

type Props = Readonly<{
  task: TaskDto;
  /** Mở drawer chi tiết — nhận id để callback ổn định (không tạo closure theo từng thẻ). */
  onOpen: (taskId: string) => void;
  /** Tay kéo (widget kanban-board cung cấp); vắng mặt với VIEWER / project lưu trữ. */
  handle?: ReactNode;
  /** Menu "⋯" (Chuyển tới…). */
  actions?: ReactNode;
  /** Đang chờ server xác nhận thay đổi — khóa kéo, hiện spinner nhỏ (frontend.md §4.2). */
  pending?: boolean;
  /** Đang được kéo (thẻ gốc mờ đi, DragOverlay hiển thị bản nổi). */
  dragging?: boolean;
  ref?: Ref<HTMLElement> | undefined;
}>;

/**
 * Thẻ task "câm" — không biết dnd hay mạng (frontend.md §2.2). Memo theo tham chiếu `task`: cache
 * board giữ nguyên tham chiếu task không đổi nên merge 1 event chỉ render lại 1 thẻ (§4.7).
 */
export const TaskCard = memo(function TaskCard({
  task,
  onOpen,
  handle,
  actions,
  pending = false,
  dragging = false,
  ref,
}: Props) {
  const titleId = `task-${task.id}-title`;
  return (
    <article
      ref={ref}
      aria-labelledby={titleId}
      data-task-id={task.id}
      className={cn(
        'flex flex-col gap-2 rounded-card border border-border bg-surface p-3 shadow-card',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-center gap-1">
        {handle}
        <span className="text-xs font-medium text-text-muted">{task.key}</span>
        {pending && <Spinner size="sm" label="Đang lưu" className="text-text-muted" />}
        <span className="ml-auto">{actions}</span>
      </div>
      <button
        type="button"
        id={titleId}
        // Thẻ kéo được bằng cả thân (widget kanban): click mà sensor đã hủy (sau kéo) ⇒ không mở drawer.
        onClick={(event) => !event.defaultPrevented && onOpen(task.id)}
        className="rounded-control text-left text-sm font-medium text-text hover:underline"
      >
        {task.title}
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <PriorityBadge priority={task.priority} />
        <DueDate dueDate={task.dueDate} done={task.status === 'DONE'} />
        <span className="ml-auto">
          {task.assignee ? (
            <Avatar
              name={task.assignee.fullName}
              colorKey={task.assignee.id}
              src={task.assignee.avatarUrl}
              size="sm"
              loading="lazy"
            />
          ) : (
            <span className="text-xs text-text-muted">Chưa giao</span>
          )}
        </span>
      </div>
    </article>
  );
});
