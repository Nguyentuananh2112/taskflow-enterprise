import type { TaskPriority } from '@taskflow/contracts/task';

import { cn } from '@/shared/lib/cn';

import { PRIORITY_LABEL } from '../model/labels';

// Ưu tiên luôn có icon + chữ, không chỉ màu (frontend.md §6.1).
const STYLE: Readonly<Record<TaskPriority, { icon: string; className: string }>> = {
  LOW: { icon: '▽', className: 'text-priority-low' },
  MEDIUM: { icon: '●', className: 'text-priority-medium' },
  HIGH: { icon: '▲', className: 'text-priority-high' },
  URGENT: { icon: '▲▲', className: 'text-priority-urgent' },
};

export function PriorityBadge({ priority }: Readonly<{ priority: TaskPriority }>) {
  const style = STYLE[priority];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', style.className)}>
      <span aria-hidden="true">{style.icon}</span>
      <span>
        <span className="sr-only">Ưu tiên: </span>
        {PRIORITY_LABEL[priority]}
      </span>
    </span>
  );
}
