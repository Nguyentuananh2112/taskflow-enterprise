import type { TaskDto, TaskStatus } from '@taskflow/contracts/task';

import { STATUS_LABEL, allowedTargets } from '@/entities/task';
import { Select } from '@/shared/ui/select';

import { intentToEdge, type ColumnIds, type MoveIntent } from '../model/compute-move-intent';

type Props = Readonly<{
  task: TaskDto;
  getColumns: () => ColumnIds;
  onMove: (task: TaskDto, intent: MoveIntent) => void;
  disabled?: boolean;
  hint?: string | undefined;
}>;

/**
 * "Trạng thái" trong drawer: chỉ liệt kê trạng thái hiện tại + đích hợp lệ (state machine), chọn ⇒
 * đặt cuối cột đích. Cùng đường `useMoveTask` với kéo thả (frontend.md §4.2).
 */
export function StatusSelect({ task, getColumns, onMove, disabled = false, hint }: Props) {
  const options = allowedTargets(task.status).map((status) => ({
    value: status,
    label: STATUS_LABEL[status],
  }));
  return (
    <Select
      label="Trạng thái"
      options={options}
      value={task.status}
      disabled={disabled}
      hint={hint}
      onChange={(event) => {
        const status = event.target.value as TaskStatus;
        const intent = intentToEdge(getColumns(), task.id, { status, edge: 'bottom' });
        if (intent) onMove(task, intent);
      }}
    />
  );
}
