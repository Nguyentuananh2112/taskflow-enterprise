'use client';

import type { MessageDto } from '@taskflow/contracts/chat';
import Link from 'next/link';
import { useState } from 'react';

import { conversationSubtitle, conversationTitle, useConversation } from '@/entities/chat';
import { GroupDialog, MuteButton } from '@/features/chat-manage';
import { Composer } from '@/features/chat-send';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

import { MessageLog } from './message-log';

/** Một cuộc trò chuyện (avatar-chat.md §7): đầu trang + luồng tin + ô soạn. `key={convId}` ở nơi dùng (reset state). */
export function ChatThread({ convId }: Readonly<{ convId: string }>) {
  const detail = useConversation(convId);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [members, setMembers] = useState(false);

  if (detail.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Đang tải cuộc trò chuyện" className="p-4">
        <Skeleton className="h-10 w-1/2" />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <EmptyState
        title="Không tìm thấy cuộc trò chuyện"
        action={
          <Link href="/chat" className="text-sm underline">
            Về danh sách trò chuyện
          </Link>
        }
      />
    );
  }

  const c = detail.data;
  const title = conversationTitle(c);
  return (
    <section aria-label={title} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link
          href="/chat"
          className="rounded-control px-2 py-1 text-sm hover:bg-bg-subtle md:hidden"
          aria-label="Về danh sách trò chuyện"
        >
          ‹
        </Link>
        <Avatar
          name={c.kind === 'DIRECT' ? (c.peer?.fullName ?? title) : title}
          colorKey={c.peer?.id ?? c.id}
          src={c.peer?.avatarUrl}
          decorative
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          <p className="truncate text-xs text-text-muted">{conversationSubtitle(c)}</p>
        </div>
        {c.kind === 'WORKSPACE' && c.workspaceId && (
          <Link href={`/w/${c.workspaceId}`} className="hidden text-sm underline sm:inline">
            Mở workspace
          </Link>
        )}
        {c.kind === 'GROUP' && (
          <Button size="sm" variant="ghost" onClick={() => setMembers(true)}>
            Thành viên
          </Button>
        )}
        <MuteButton convId={c.id} muted={c.muted} />
      </header>
      <MessageLog detail={c} onReply={setReplyTo} />
      {c.canSend ? (
        <Composer convId={c.id} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
      ) : (
        <p className="border-t border-border p-3 text-center text-sm text-text-muted">
          Người này không còn ở công ty — bạn vẫn xem được tin cũ.
        </p>
      )}
      {members && <GroupDialog detail={c} onClose={() => setMembers(false)} />}
    </section>
  );
}
