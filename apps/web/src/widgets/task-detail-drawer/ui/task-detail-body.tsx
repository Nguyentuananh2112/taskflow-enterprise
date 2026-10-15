'use client';

import type { TaskDto } from '@taskflow/contracts/task';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { PermissionApi } from '@/entities/workspace';
import {
  canDeleteTask,
  taskKeys,
  toColumns,
  type BoardData,
  type TaskScope,
} from '@/entities/task';
import { AssignPanel } from '@/features/task-assign';
import { DeleteTaskButton } from '@/features/task-delete';
import { EditTaskForm } from '@/features/task-edit';
import { StatusSelect, toColumnIds, useMoveTask, type MoveIntent } from '@/features/task-move';

import { TaskHistory } from './task-history';
import { TaskReadOnly } from './task-read-only';

const ARCHIVED_HINT = 'Dự án đã lưu trữ — chỉ đọc';

type Props = Readonly<{
  scope: TaskScope;
  task: TaskDto;
  permission: PermissionApi;
  archived: boolean;
  onClose: () => void;
}>;

/** Nội dung drawer khi đã có task: ghép các feature theo quyền (frontend.md §1.3, §5). */
export function TaskDetailBody({ scope, task, permission, archived, onClose }: Props) {
  const { can, viewerId } = permission;
  const client = useQueryClient();
  const { mutate: move } = useMoveTask(scope);
  /** `version` gốc khi form đang sửa — khóa `key` để không mount lại form giữa chừng (§4.6). */
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const getColumns = useCallback(() => {
    const board = client.getQueryData<BoardData>(taskKeys.board(scope.wsId, scope.projectId));
    return toColumnIds(toColumns(board ?? { byId: { [task.id]: task } }));
  }, [client, scope.wsId, scope.projectId, task]);
  const onMove = useCallback((base: TaskDto, intent: MoveIntent) => move({ base, intent }), [move]);
  const editable = can('task:update') && !archived;

  return (
    <div className="flex flex-col gap-6">
      {editable ? (
        <EditTaskForm
          key={`${task.id}:${editingVersion ?? task.version}`}
          scope={scope}
          task={task}
          onEditingChange={setEditingVersion}
        />
      ) : (
        <TaskReadOnly task={task} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {can('task:move') && (
          <StatusSelect
            task={task}
            getColumns={getColumns}
            onMove={onMove}
            disabled={archived}
            hint={archived ? ARCHIVED_HINT : undefined}
          />
        )}
        <AssignPanel scope={scope} task={task} can={can} viewerId={viewerId} archived={archived} />
      </div>
      {task.createdBy && (
        <p className="text-xs text-text-muted">
          Người tạo: {task.createdBy.fullName} ·{' '}
          <time dateTime={task.createdAt}>{new Date(task.createdAt).toLocaleString('vi-VN')}</time>
        </p>
      )}
      <TaskHistory scope={{ ...scope, taskId: task.id }} />
      {canDeleteTask(can, viewerId, task) && (
        <div className="border-t border-border pt-4">
          <DeleteTaskButton scope={scope} task={task} archived={archived} onDeleted={onClose} />
        </div>
      )}
    </div>
  );
}
