import { TASK_STATUS_TRANSITIONS, type TaskDto } from '@taskflow/contracts/task';

import { STATUS_LABEL } from '@/entities/task';
import { DropdownMenu, type MenuItem } from '@/shared/ui/dropdown-menu';

import { intentToEdge, type ColumnIds, type MoveIntent } from '../model/compute-move-intent';

type Props = Readonly<{
  task: TaskDto;
  /** Đọc cột lúc chọn (không truyền mảng ⇒ thẻ không render lại mỗi khi cột đổi). */
  getColumns: () => ColumnIds;
  onMove: (task: TaskDto, intent: MoveIntent) => void;
}>;

/**
 * "⋯" trên thẻ — đường thay thế không cần kéo (WCAG 2.2 SC 2.5.7, frontend.md §4.2): "Chuyển tới"
 * CHỈ liệt kê cột hợp lệ theo state machine (đặt cuối cột), "Lên đầu cột", "Xuống cuối cột".
 */
export function MoveMenu({ task, getColumns, onMove }: Props) {
  const go = (status: TaskDto['status'], edge: 'top' | 'bottom') => () => {
    const intent = intentToEdge(getColumns(), task.id, { status, edge });
    if (intent) onMove(task, intent);
  };
  const items: MenuItem[] = [
    ...TASK_STATUS_TRANSITIONS[task.status].map((status) => ({
      key: `to-${status}`,
      label: `Chuyển tới ${STATUS_LABEL[status]}`,
      onSelect: go(status, 'bottom'),
    })),
    { key: 'top', label: 'Lên đầu cột', onSelect: go(task.status, 'top') },
    { key: 'bottom', label: 'Xuống cuối cột', onSelect: go(task.status, 'bottom') },
  ];
  return <DropdownMenu label={`Thao tác với ${task.key}`} items={items} />;
}
