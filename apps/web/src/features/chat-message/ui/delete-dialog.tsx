'use client';

import type { MessageDto } from '@taskflow/contracts/chat';

import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';

import { useDeleteMessage } from '../model/use-message-actions';

type Props = Readonly<{ message: MessageDto; onClose: () => void }>;

/** Xóa tin của mình (ADR-144): thân + tệp mất với mọi người; không ai khác xóa được. */
export function DeleteDialog({ message, onClose }: Props) {
  const remove = useDeleteMessage(message.conversationId);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Xóa tin nhắn"
      description="Tin và tệp đính kèm sẽ bị xóa với mọi người trong cuộc trò chuyện."
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Hủy</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate(message, { onSuccess: onClose })}
          >
            Xóa
          </Button>
        </>
      }
    >
      {remove.isError && (
        <p role="alert" className="text-sm text-danger">
          Chưa xóa được — thử lại.
        </p>
      )}
    </Dialog>
  );
}
