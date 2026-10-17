'use client';

import type { ConversationDetailDto, MessageDto } from '@taskflow/contracts/chat';
import { Fragment, useRef, useState } from 'react';

import { flatten, useMessages } from '@/entities/chat';
import { useSession } from '@/entities/session';
import { MessageItem } from '@/features/chat-message';
import { isPending, useSendMessage } from '@/features/chat-send';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

import { useMarkRead } from '../model/use-mark-read';
import { useScrollAnchor } from '../model/use-scroll-anchor';
import { LiveRegion, TypingLine } from './thread-extras';

type Props = Readonly<{
  detail: ConversationDetailDto;
  onReply: (m: MessageDto) => void;
}>;

/**
 * Luồng tin (avatar-chat.md §7 E8): `log "Tin nhắn"` (không tự đọc — có vùng sr-only riêng), cuộn ngược giữ chỗ, vạch
 * "Tin chưa đọc" theo con trỏ LÚC MỞ, "Đã xem" ở DIRECT, đánh dấu đọc khi tab hiện + tin cuối trong khung nhìn.
 */
export function MessageLog({ detail, onReply }: Props) {
  const me = useSession().user?.id;
  const query = useMessages(detail.id);
  const { retry, discard, isFailed } = useSendMessage(detail.id);
  const messages = flatten(query.data);
  const newest = messages.at(-1);
  // Lúc mở: con trỏ đọc + mốc giờ (vạch chưa đọc đứng yên trong phiên; vùng đọc to chỉ tin đến SAU mốc này).
  const [opened] = useState(() => ({ lastRead: detail.lastReadMessageId, at: Date.now() }));
  const sentinel = useRef<HTMLDivElement>(null);
  const { ref: logRef, onScroll } = useScrollAnchor({
    pages: query.data?.pages.length ?? 0,
    newestId: newest?.id,
    newestIsMine: newest?.sender.id === me,
  });
  useMarkRead(
    detail.id,
    newest && !isPending(newest) ? newest.id : undefined,
    detail.lastReadMessageId,
    sentinel,
  );

  const readIdx = opened.lastRead ? messages.findIndex((m) => m.id === opened.lastRead) : -1;
  const firstUnread = messages.findIndex((m, i) => i > readIdx && m.sender.id !== me);
  const peerIdx = detail.peerLastReadMessageId
    ? messages.findIndex((m) => m.id === detail.peerLastReadMessageId)
    : -1;
  const seenIdx = messages.findLastIndex((m, i) => i <= peerIdx && m.sender.id === me);
  const incoming = messages.findLast(
    (m) => m.sender.id !== me && Date.parse(m.createdAt) > opened.at,
  );

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Đang tải tin nhắn"
        className="flex-1 space-y-3 p-4"
      >
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="ml-auto h-10 w-1/2" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Không tải được tin nhắn"
        action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
      />
    );
  }

  return (
    <>
      <div
        ref={logRef}
        onScroll={onScroll}
        role="log"
        aria-label="Tin nhắn"
        aria-live="off"
        className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {query.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Tải tin cũ hơn
          </Button>
        )}
        {messages.length === 0 && (
          <p className="m-auto text-sm text-text-muted">Chưa có tin nhắn nào. Hãy gửi lời chào!</p>
        )}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {i === firstUnread && readIdx >= 0 && (
              <p role="separator" className="text-center text-xs font-medium text-danger">
                Tin chưa đọc
              </p>
            )}
            <MessageItem
              message={m}
              mine={m.sender.id === me}
              showSender={detail.kind !== 'DIRECT'}
              status={isFailed(m.clientMsgId) ? 'failed' : isPending(m) ? 'pending' : 'sent'}
              seen={detail.kind === 'DIRECT' && i === seenIdx}
              onReply={onReply}
              onRetry={() => void retry(m.clientMsgId).catch(() => undefined)}
              onDiscard={() => discard(m.clientMsgId)}
            />
          </Fragment>
        ))}
        <div ref={sentinel} aria-hidden="true" className="h-px" />
      </div>
      <TypingLine detail={detail} />
      <LiveRegion newestIncoming={incoming} />
    </>
  );
}
