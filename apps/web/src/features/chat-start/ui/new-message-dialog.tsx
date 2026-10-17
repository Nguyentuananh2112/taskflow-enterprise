'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { chatApi, chatErrorText, chatKeys, PeoplePicker } from '@/entities/chat';
import { useSession } from '@/entities/session';
import { Alert } from '@/shared/ui/alert';
import { Dialog } from '@/shared/ui/dialog';

type Props = Readonly<{ onClose: () => void }>;

/** "Tin nhắn mới" (§7): chọn một người ⇒ `POST chat/direct` (tạo-hoặc-lấy) ⇒ mở cuộc trò chuyện. */
export function NewMessageDialog({ onClose }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useSession().user?.id;
  const start = useMutation({
    mutationFn: (userId: string) => chatApi.direct(userId),
    onSuccess: (conv) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      onClose();
      router.push(`/chat/${conv.id}`);
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Tin nhắn mới">
      <PeoplePicker
        exclude={new Set(me ? [me] : [])}
        onPick={(p) => start.mutate(p.id)}
        disabled={start.isPending}
      />
      {start.isError && <Alert>{chatErrorText(start.error)}</Alert>}
    </Dialog>
  );
}
