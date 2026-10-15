'use client';

import type { TaskDto } from '@taskflow/contracts/task';
import { useState } from 'react';

import type { PermissionApi } from '@/entities/workspace';
import { useTask, type TaskScope } from '@/entities/task';
import { Button } from '@/shared/ui/button';
import { Drawer } from '@/shared/ui/drawer';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { toast } from '@/shared/ui/toast';

import { TaskDetailBody } from './task-detail-body';

type Props = Readonly<{
  scope: TaskScope;
  /** Từ `?task=` trên URL — `null` ⇒ drawer đóng. */
  taskId: string | null;
  permission: PermissionApi;
  archived: boolean;
  onClose: () => void;
  /** Trả focus về thẻ đã mở drawer (frontend.md §4.2: focus quay về thẻ khi đóng). */
  onCloseAutoFocus?: (event: Event) => void;
}>;

const copyLink = () =>
  void navigator.clipboard
    ?.writeText(window.location.href)
    .then(() => toast({ title: 'Đã sao chép link task', tone: 'success' }))
    .catch(() => toast({ title: 'Không sao chép được link', tone: 'error' }));

/**
 * Drawer phải chi tiết task (frontend.md §1.1): board vẫn hiển thị phía sau ⇒ thấy thẻ di chuyển
 * realtime; URL `?task=` chia sẻ được; Esc / click ra ngoài / nút Back đóng.
 */
export function TaskDetailDrawer(props: Props) {
  const { scope, taskId, permission, archived, onClose } = props;
  const { task: live, isPending } = useTask(scope, taskId);
  // Giữ bản cuối của task đang mở: xóa optimistic gỡ thẻ khỏi board ngay, nhưng drawer (và hộp
  // thoại xác nhận "Vẫn xóa?" khi 409) phải còn tới khi server trả lời.
  const [last, setLast] = useState<TaskDto | undefined>(live);
  if (live && live !== last) setLast(live);
  const task = live ?? (last?.id === taskId ? last : undefined);
  return (
    <Drawer
      open={taskId !== null}
      {...(props.onCloseAutoFocus ? { onCloseAutoFocus: props.onCloseAutoFocus } : {})}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={task?.key ?? 'Chi tiết task'}
      headerActions={
        task ? (
          <Button variant="ghost" size="sm" onClick={copyLink}>
            Sao chép link
          </Button>
        ) : undefined
      }
    >
      {isPending && !task && (
        <div role="status" aria-busy="true" aria-label="Đang tải task" className="grid gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
        </div>
      )}
      {!isPending && !task && (
        <EmptyState
          title="Task không còn tồn tại"
          description="Task có thể đã bị xóa, hoặc bạn không có quyền xem."
          action={<Button onClick={onClose}>Đóng</Button>}
        />
      )}
      {task && (
        <TaskDetailBody
          scope={scope}
          task={task}
          permission={permission}
          archived={archived}
          onClose={onClose}
        />
      )}
    </Drawer>
  );
}
