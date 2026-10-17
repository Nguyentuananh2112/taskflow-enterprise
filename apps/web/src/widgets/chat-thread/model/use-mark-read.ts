import type { ConversationDetailDto } from '@taskflow/contracts/chat';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { chatApi, chatKeys } from '@/entities/chat';

// Đánh dấu đã đọc (avatar-chat.md §7 E8): chỉ khi tab ĐANG HIỆN và tin cuối lọt vào khung nhìn (IntersectionObserver),
// debounce 1 s; con trỏ chỉ tiến (server cũng vậy). Sau đó cập nhật cache detail + tổng chưa đọc.

const DEBOUNCE_MS = 1_000;

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

export function useMarkRead(
  convId: string,
  newestId: string | undefined,
  lastReadId: string | null | undefined,
  sentinel: RefObject<HTMLElement | null>,
) {
  const queryClient = useQueryClient();
  // Không có IntersectionObserver (trình duyệt cũ / jsdom) ⇒ coi như tin cuối đang thấy.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  const [shown, setShown] = useState(visible);
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) =>
      setInView(entries.some((e) => e.isIntersecting)),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sentinel]);

  useEffect(() => {
    const onChange = () => setShown(visible());
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  useEffect(() => {
    if (!newestId || !inView || !shown || newestId === lastReadId || sent.current === newestId)
      return;
    const timer = setTimeout(() => {
      sent.current = newestId;
      chatApi
        .markRead(convId, newestId)
        .then(() => {
          queryClient.setQueryData<ConversationDetailDto>(
            chatKeys.detail(convId),
            (old) => old && { ...old, lastReadMessageId: newestId, unread: 0 },
          );
          void queryClient.invalidateQueries({ queryKey: chatKeys.unread });
          void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
        })
        .catch(() => {
          sent.current = null; // thử lại lần sau
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [convId, newestId, lastReadId, inView, shown, queryClient]);
}
