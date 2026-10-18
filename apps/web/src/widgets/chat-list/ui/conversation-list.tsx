'use client';

import { useState } from 'react';

import { useConversations } from '@/entities/chat';
import { useSession } from '@/entities/session';
import { CreateGroupDialog, NewMessageDialog } from '@/features/chat-start';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

import { ConversationItem } from './conversation-item';

type Props = Readonly<{ activeId?: string | undefined }>;

/** Danh sách trò chuyện (avatar-chat.md §7): mới nhất trước, "Tin nhắn mới", "Tạo nhóm", "Tải thêm". */
export function ConversationList({ activeId }: Props) {
  const me = useSession().user?.id;
  const list = useConversations();
  const [dialog, setDialog] = useState<'direct' | 'group' | null>(null);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <nav aria-label="Danh sách trò chuyện" className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h1 className="mr-auto text-lg font-semibold">Trò chuyện</h1>
        <Button size="sm" onClick={() => setDialog('direct')}>
          Tin nhắn mới
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setDialog('group')}>
          Tạo nhóm
        </Button>
      </div>
      {list.isPending ? (
        <div role="status" aria-busy="true" aria-label="Đang tải trò chuyện" className="grid gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : list.isError ? (
        <EmptyState
          title="Không tải được trò chuyện"
          action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="Chưa có cuộc trò chuyện nào" />
      ) : (
        <ul className="flex flex-col overflow-y-auto">
          {rows.map((c) => (
            <ConversationItem key={c.id} c={c} me={me} active={c.id === activeId} />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          className="self-center"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Tải thêm
        </Button>
      )}
      {dialog === 'direct' && <NewMessageDialog onClose={() => setDialog(null)} />}
      {dialog === 'group' && <CreateGroupDialog onClose={() => setDialog(null)} />}
    </nav>
  );
}
