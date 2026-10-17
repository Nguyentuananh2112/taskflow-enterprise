import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { chatApi } from '../api/chat.api';
import type { MessagePage } from './message-cache';

/** Gốc `['chat', …]` — xóa sạch khi đăng xuất / SESSION_REVOKED (§7 Realtime). */
export const chatKeys = {
  all: ['chat'] as const,
  conversations: ['chat', 'conversations'] as const,
  unread: ['chat', 'unread'] as const,
  detail: (id: string) => ['chat', 'conversation', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
  people: (q: string) => ['chat', 'people', q] as const,
  /** Phòng của workspace đã phân giải (`PUT chat/workspaces/:wsId/conversation`). */
  wsRoom: (wsId: string) => ['chat', 'ws-room', wsId] as const,
};

const nextCursor = (last: {
  page?: { hasMore: boolean; nextCursor: string | null } | undefined;
}) => (last.page?.hasMore ? (last.page.nextCursor ?? undefined) : undefined);

/** Danh sách hội thoại, mới nhất trước (keyset `cursor`). */
export function useConversations() {
  return useInfiniteQuery({
    queryKey: chatKeys.conversations,
    queryFn: ({ pageParam }) => chatApi.conversations(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    staleTime: 30_000,
  });
}

/** Tổng chưa đọc cho icon header (bỏ hội thoại tắt tiếng — server tính). */
export function useChatUnread(enabled = true) {
  return useQuery({
    queryKey: chatKeys.unread,
    queryFn: async () => (await chatApi.unreadCount()).total,
    enabled,
    staleTime: 30_000,
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: chatKeys.detail(id),
    queryFn: () => chatApi.detail(id),
    staleTime: 30_000,
  });
}

/** Luồng tin: trang 0 = mới nhất; `fetchNextPage` = trang CŨ hơn (`before` = id tin cũ nhất đang có). */
export function useMessages(id: string) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(id),
    queryFn: async ({ pageParam }): Promise<MessagePage> => {
      const { data, page } = await chatApi.messages(id, pageParam ? { before: pageParam } : {});
      return { data, page: page ? { hasMore: page.hasMore } : undefined };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.page?.hasMore ? last.data[0]?.id : undefined),
    staleTime: Infinity, // realtime + catch-up giữ cho mới; không refetch cả luồng
  });
}

/** Danh bạ (`q` 1–100 ký tự). */
export function useChatPeople(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: chatKeys.people(term),
    queryFn: () => chatApi.people(term),
    enabled: term.length > 0,
    staleTime: 60_000,
  });
}
