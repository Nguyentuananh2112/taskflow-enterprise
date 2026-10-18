'use client';

import { CHAT_GROUP_MAX_OTHERS, type ChatPersonDto } from '@taskflow/contracts/chat';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { chatApi, chatErrorText, chatKeys, PeoplePicker } from '@/entities/chat';
import { useSession } from '@/entities/session';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';

type Props = Readonly<{ onClose: () => void }>;

/** "Tạo nhóm" (ADR-143): tên 1–80 ký tự, ≥ 2 người khác (≤ 99); người tạo là trưởng nhóm. */
export function CreateGroupDialog({ onClose }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useSession().user?.id;
  const [title, setTitle] = useState('');
  const [members, setMembers] = useState<ChatPersonDto[]>([]);
  const create = useMutation({
    mutationFn: () => chatApi.group({ title: title.trim(), memberIds: members.map((m) => m.id) }),
    onSuccess: (conv) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      onClose();
      router.push(`/chat/${conv.id}`);
    },
  });
  const ready =
    title.trim().length > 0 && members.length >= 2 && members.length <= CHAT_GROUP_MAX_OTHERS;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Tạo nhóm"
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Hủy</Button>
          </DialogClose>
          <Button disabled={!ready} loading={create.isPending} onClick={() => create.mutate()}>
            Tạo nhóm
          </Button>
        </>
      }
    >
      <Input
        label="Tên nhóm"
        maxLength={80}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <PeoplePicker
        label="Thêm người"
        exclude={new Set([...(me ? [me] : []), ...members.map((m) => m.id)])}
        onPick={(p) => setMembers((list) => [...list, p])}
      />
      {members.length > 0 && (
        <ul aria-label="Người trong nhóm" className="flex flex-wrap gap-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-1 rounded-control bg-bg-subtle px-2 py-1 text-sm"
            >
              {m.fullName}
              <button
                type="button"
                aria-label={`Bỏ ${m.fullName}`}
                onClick={() => setMembers((list) => list.filter((x) => x.id !== m.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-text-muted">Chọn ít nhất 2 người.</p>
      {create.isError && <Alert>{chatErrorText(create.error)}</Alert>}
    </Dialog>
  );
}
