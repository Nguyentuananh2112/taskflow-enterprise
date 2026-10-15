'use client';

import type { TaskDto } from '@taskflow/contracts/task';
import { useState } from 'react';

import { conflictCurrent, type TaskScope } from '@/entities/task';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

import { useDeleteTask } from '../model/use-delete-task';

type Props = Readonly<{
  scope: TaskScope;
  task: TaskDto;
  /** Project lưu trữ cấm cả xóa (ADR-045): hiện nhưng khóa. */
  archived: boolean;
  onDeleted: () => void;
}>;

/** Nút xóa + dialog xác nhận. Chỉ render khi `canDeleteTask` (drawer quyết định). */
export function DeleteTaskButton({ scope, task, archived, onDeleted }: Props) {
  const remove = useDeleteTask(scope);
  const [open, setOpen] = useState(false);
  /** Bản mới nhất khi 409 — dialog đổi thành "Vẫn xóa?". */
  const [changed, setChanged] = useState<TaskDto | null>(null);

  const confirm = async () => {
    const base = changed ?? task;
    try {
      await remove.mutateAsync({ base });
      setOpen(false);
      toast({ title: `Đã xóa ${base.key}`, tone: 'success' });
      onDeleted();
    } catch (error) {
      const current = conflictCurrent(error);
      if (current) setChanged(current);
      else setOpen(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setChanged(null);
      }}
      trigger={
        <Button
          variant="danger"
          disabled={archived}
          title={archived ? 'Dự án đã lưu trữ — chỉ đọc' : undefined}
        >
          Xóa task
        </Button>
      }
      title={changed ? 'Task vừa được người khác thay đổi' : `Xóa ${task.key}?`}
      description={
        changed
          ? `${changed.key} vừa được cập nhật sau khi bạn mở. Vẫn xóa bản mới nhất?`
          : 'Task sẽ bị ẩn khỏi bảng. Lịch sử thay đổi vẫn được giữ.'
      }
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Hủy</Button>
          </DialogClose>
          <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
            {changed ? 'Vẫn xóa' : 'Xóa'}
          </Button>
        </>
      }
    />
  );
}
