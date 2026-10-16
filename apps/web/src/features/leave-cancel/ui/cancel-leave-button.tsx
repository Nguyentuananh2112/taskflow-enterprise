'use client';

import { useMutation } from '@tanstack/react-query';
import * as z from 'zod';

import { LEAVE_TYPE_NAME, leaveApi, leaveKeys, leaveRange } from '@/entities/leave';
import { isApiError } from '@/shared/api';
import type { LeaveRequestDto } from '@taskflow/contracts/leave';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

const Reason = z.object({ reason: z.string() });

function cancelError(error: unknown): string {
  if (isApiError(error, 'VERSION_CONFLICT'))
    return 'Đơn vừa được cập nhật ở nơi khác — đã tải lại.';
  if (
    isApiError(error, 'RESOURCE_CONFLICT') &&
    Reason.safeParse(error.details).data?.reason === 'invalid_transition'
  ) {
    return 'Đơn đã bắt đầu hoặc đã được xử lý — không hủy được nữa.';
  }
  return serverErrorMessage(error);
}

type Props = Readonly<{ wsId: string; request: LeaveRequestDto }>;

/** Hủy đơn của chính mình (PENDING, hoặc APPROVED chưa tới ngày — §5), có xác nhận, gửi `expectedVersion`. */
export function CancelLeaveButton({ wsId, request }: Props) {
  const cancel = useMutation({
    mutationFn: () => leaveApi.cancel(wsId, request.id, request.version),
    onSuccess: () => toast({ title: 'Đã hủy đơn', tone: 'success' }),
    onError: (error) => toast({ title: cancelError(error), tone: 'error' }),
    onSettled: (_d, _e, _v, _r, context) =>
      void context.client.invalidateQueries({ queryKey: leaveKeys.all(wsId) }),
  });
  return (
    <Dialog
      trigger={
        // Kèm loại nghỉ: chỉ đơn còn hiệu lực có nút, và server cấm đơn còn hiệu lực trùng ngày
        // (overlapping_leave) ⇒ "loại + khoảng ngày" không trùng giữa các nút.
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Hủy đơn ${LEAVE_TYPE_NAME[request.type]} ${leaveRange(request)}`}
        >
          Hủy đơn
        </Button>
      }
      title="Hủy đơn nghỉ?"
      description={`Đơn ${leaveRange(request)} sẽ bị hủy.${request.status === 'APPROVED' ? ' Ngày phép được trả lại.' : ''}`}
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Giữ đơn</Button>
          </DialogClose>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Hủy đơn
          </Button>
        </>
      }
    />
  );
}
