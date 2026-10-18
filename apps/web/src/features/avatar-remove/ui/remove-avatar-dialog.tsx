'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAvatarViews } from '@/entities/session';
import { isApiError } from '@/shared/api';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

import { removeAvatarOf } from '../api/avatar-remove.api';

type Target = Readonly<{ userId: string; fullName: string }>;
type Props = Readonly<{ employee: Target; onClose: () => void }>;

function message(error: unknown): string {
  if (isApiError(error) && error.status === 403) return 'Bạn không có quyền gỡ ảnh của người này.';
  if (isApiError(error) && error.status === 404)
    return 'Người này không còn trong danh sách nhân viên.';
  return 'Chưa gỡ được ảnh, hãy thử lại.';
}

/**
 * HR / Admin gỡ ảnh đại diện không phù hợp (avatar-chat.md ADR-142; audit `AVATAR_REMOVED` ở server). Dialog ở CẤP
 * TRANG `/hr/employees` (E12). Danh sách nhân viên chưa có avatar (DTO HR để nguyên — ADR-142) ⇒ câu hỏi nói "nếu có".
 */
export function RemoveAvatarDialog({ employee, onClose }: Props) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeAvatarOf(employee.userId),
    onSuccess: () => {
      void invalidateAvatarViews(queryClient, employee.userId);
      toast({ title: `Đã gỡ ảnh đại diện của ${employee.fullName}`, tone: 'success' });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Gỡ ảnh đại diện"
      description={`Nếu ${employee.fullName} đang có ảnh đại diện, ảnh sẽ bị gỡ và thay bằng chữ cái. Người đó vẫn có thể đặt ảnh khác.`}
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Hủy</Button>
          </DialogClose>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            Gỡ ảnh
          </Button>
        </>
      }
    >
      {remove.isError && <Alert>{message(remove.error)}</Alert>}
    </Dialog>
  );
}
