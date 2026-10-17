'use client';

import type { MessageDto } from '@taskflow/contracts/chat';
import { useState } from 'react';

import { Button } from '@/shared/ui/button';

import { useEditMessage } from '../model/use-message-actions';

type Props = Readonly<{ message: MessageDto; onDone: () => void }>;

/** Sửa tin của mình (≤ 15 phút — server quyết: 422 EDIT_WINDOW_PASSED ⇒ báo, giữ nguyên văn). */
export function EditForm({ message, onDone }: Props) {
  const [draft, setDraft] = useState(message.body ?? '');
  const edit = useEditMessage(message.conversationId);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        edit.mutate({ id: message.id, body: draft }, { onSuccess: onDone });
      }}
    >
      <textarea
        aria-label="Sửa tin"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="min-h-16 rounded-control border border-border bg-surface p-2 text-text"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Hủy
        </Button>
        <Button type="submit" size="sm" loading={edit.isPending} disabled={!draft.trim()}>
          Lưu
        </Button>
      </div>
      {edit.isError && (
        <span role="alert" className="text-xs">
          Quá 15 phút hoặc tin đã đổi — không sửa được.
        </span>
      )}
    </form>
  );
}
