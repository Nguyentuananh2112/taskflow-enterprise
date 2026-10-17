import {
  ChatConversationRemovedEvent,
  ChatConversationUpdatedEvent,
  ChatMessageNewEvent,
  ChatMessageUpdatedEvent,
  ChatReadEvent,
  ChatTypingEvent,
} from '@taskflow/contracts/realtime';
import type { ConversationDetailDto } from '@taskflow/contracts/chat';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  appendMessages,
  chatApi,
  chatKeys,
  newestMessage,
  upsertMessage,
  type MessagesData,
} from '@/entities/chat';
import { useSession } from '@/entities/session';
import { isApiError } from '@/shared/api';
import { useRealtimeClient } from '@/shared/socket';
import { toast } from '@/shared/ui/toast';

import { typingStore } from './typing-store';

// Realtime trò chuyện (avatar-chat.md ADR-145, §7): event tới `user:{id}` ⇒ vá cache `['chat', …]`. Nối lại ⇒ bù bằng
// `GET …/messages?after=` cho MỌI luồng đang cache + tải lại danh sách (event lỡ khi rớt mạng). Đăng xuất /
// SESSION_REVOKED ⇒ `queryClient.clear()` (app/providers) dọn cả chat.

const refreshLists = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: chatKeys.conversations });
  void qc.invalidateQueries({ queryKey: chatKeys.unread });
};

/**
 * Bù mọi luồng đang cache sau khi nối lại; gộp theo id (không trùng). Trả các hội thoại đã MẤT QUYỀN (404 — bị bớt / rời
 * lúc offline, lỡ `chat:conversation:removed`, B L1) để xử lý như removed. Lỗi khác (mạng lại rớt) ⇒ lần nối sau bù tiếp.
 */
async function catchUp(qc: QueryClient): Promise<string[]> {
  const cached = qc.getQueriesData<MessagesData>({ queryKey: ['chat', 'messages'] });
  const gone: string[] = [];
  await Promise.all(
    cached.map(async ([key, data]) => {
      const convId = String(key[2]);
      const after = newestMessage(data)?.id;
      if (!after) return;
      try {
        const { data: missed } = await chatApi.messages(convId, { after });
        qc.setQueryData<MessagesData>(key, (old) => appendMessages(old, missed));
      } catch (error) {
        if (isApiError(error, 'RESOURCE_NOT_FOUND')) gone.push(convId);
      }
    }),
  );
  return gone;
}

/**
 * Mất quyền một hội thoại ⇒ xóa tin + chi tiết khỏi cache (mất quyền ⇒ mất lịch sử, §3). Trả `true` khi người dùng đang
 * xem nó — ở `/chat/[id]` hoặc ở `/chat/ws/[wsId]` mà phòng đã phân giải ra đúng hội thoại này (B L2).
 */
export function forget(qc: QueryClient, conversationId: string, pathname: string): boolean {
  qc.removeQueries({ queryKey: chatKeys.messages(conversationId) });
  qc.removeQueries({ queryKey: chatKeys.detail(conversationId) });
  refreshLists(qc);
  const wsId = /^\/chat\/ws\/([^/]+)/.exec(pathname)?.[1];
  const onRoom =
    wsId !== undefined &&
    qc.getQueryData<{ id: string }>(chatKeys.wsRoom(wsId))?.id === conversationId;
  if (onRoom) qc.removeQueries({ queryKey: chatKeys.wsRoom(wsId) });
  return onRoom || pathname === `/chat/${conversationId}`;
}

export function useChatRealtime(): void {
  const client = useRealtimeClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const path = useRef(pathname);
  const myId = useSession().user?.id;
  const me = useRef(myId);
  useEffect(() => {
    path.current = pathname;
    me.current = myId;
  });

  useEffect(() => {
    const removed = (conversationId: string) => {
      if (!forget(queryClient, conversationId, path.current)) return;
      router.replace('/chat');
      toast({ title: 'Bạn không còn ở cuộc trò chuyện này' });
    };
    const patch = (
      raw: unknown,
      schema: typeof ChatMessageNewEvent | typeof ChatMessageUpdatedEvent,
    ) => {
      const event = schema.safeParse(raw);
      if (!event.success) return;
      const { message } = event.data.data;
      queryClient.setQueryData<MessagesData>(chatKeys.messages(message.conversationId), (old) =>
        upsertMessage(old, message),
      );
      typingStore.stop(message.conversationId, message.sender.id);
      refreshLists(queryClient);
    };
    const offs = [
      client.on('chat:message:new', (raw) => patch(raw, ChatMessageNewEvent)),
      client.on('chat:message:updated', (raw) => patch(raw, ChatMessageUpdatedEvent)),
      client.on('chat:read', (raw) => {
        const event = ChatReadEvent.safeParse(raw);
        if (!event.success) return;
        const { conversationId, userId, messageId } = event.data.data;
        // Của mình (thiết bị khác) ⇒ vạch "Tin chưa đọc"; của người kia (DIRECT) ⇒ "Đã xem".
        const mine = me.current === userId;
        queryClient.setQueryData<ConversationDetailDto>(
          chatKeys.detail(conversationId),
          (old) =>
            old &&
            (mine
              ? { ...old, lastReadMessageId: messageId }
              : { ...old, peerLastReadMessageId: messageId }),
        );
        refreshLists(queryClient); // thiết bị khác của mình đã đọc
      }),
      client.on('chat:conversation:updated', (raw) => {
        const event = ChatConversationUpdatedEvent.safeParse(raw);
        if (!event.success) return;
        void queryClient.invalidateQueries({
          queryKey: chatKeys.detail(event.data.data.conversation.id),
        });
        refreshLists(queryClient);
      }),
      client.on('chat:conversation:removed', (raw) => {
        const event = ChatConversationRemovedEvent.safeParse(raw);
        if (event.success) removed(event.data.data.conversationId);
      }),
      client.on('chat:typing', (raw) => {
        const event = ChatTypingEvent.safeParse(raw);
        if (event.success)
          typingStore.start(event.data.data.conversationId, event.data.data.userId);
      }),
      client.onReconnect(() => {
        void catchUp(queryClient).then((gone) => gone.forEach(removed));
        refreshLists(queryClient);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [client, queryClient, router]);
}
