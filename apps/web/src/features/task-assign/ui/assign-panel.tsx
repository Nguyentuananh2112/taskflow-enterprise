'use client';

import type { TaskDto } from '@taskflow/contracts/task';

import { useAssignableMembers } from '@/entities/member';
import { canAssignAnyone, canAssignTask, type Can, type TaskScope } from '@/entities/task';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Select } from '@/shared/ui/select';

import { useAssignTask } from '../model/use-assign-task';

type Props = Readonly<{
  scope: TaskScope;
  task: TaskDto;
  can: Can;
  viewerId: string | null;
  /** Project lưu trữ: hiện nhưng khóa, kèm lý do (frontend.md §1.3). */
  archived: boolean;
}>;

/**
 * Người phụ trách (ADR-041/044): PM+ hoặc người tạo task ⇒ picker (chỉ role ≥ MEMBER); MEMBER khác ⇒
 * "Nhận việc" (task trống) / "Bỏ nhận" (task của mình); VIEWER ⇒ chỉ xem.
 */
export function AssignPanel({ scope, task, can, viewerId, archived }: Props) {
  const assign = useAssignTask(scope, task.id);
  const picker = canAssignAnyone(can, viewerId, task);
  const members = useAssignableMembers(scope.wsId, '', picker && !archived);
  const send = (assigneeId: string | null) => assign.mutate({ base: task, assigneeId });

  if (picker) {
    const options = [
      { value: '', label: 'Chưa giao' },
      ...(task.assignee && !members.data?.some((m) => m.userId === task.assignee?.id)
        ? [{ value: task.assignee.id, label: task.assignee.fullName }]
        : []),
      ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName })),
    ];
    return (
      <Select
        label="Người phụ trách"
        options={options}
        value={task.assignee?.id ?? ''}
        disabled={archived || assign.isPending}
        hint={archived ? 'Dự án đã lưu trữ — chỉ đọc' : undefined}
        onChange={(event) => send(event.target.value || null)}
      />
    );
  }

  const canClaim = task.assignee === null && canAssignTask(can, viewerId, task, viewerId);
  const canRelease = task.assignee?.id === viewerId && canAssignTask(can, viewerId, task, null);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">Người phụ trách</span>
      <div className="flex items-center gap-2">
        {task.assignee ? (
          <>
            <Avatar
              name={task.assignee.fullName}
              colorKey={task.assignee.id}
              size="sm"
              decorative
            />
            <span className="text-sm">{task.assignee.fullName}</span>
          </>
        ) : (
          <span className="text-sm text-text-muted">Chưa giao</span>
        )}
        {(canClaim || canRelease) && (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            loading={assign.isPending}
            disabled={archived}
            title={archived ? 'Dự án đã lưu trữ — chỉ đọc' : undefined}
            onClick={() => send(canClaim ? viewerId : null)}
          >
            {canClaim ? 'Nhận việc' : 'Bỏ nhận'}
          </Button>
        )}
      </div>
    </div>
  );
}
