'use client';

import { useParams } from 'next/navigation';

import { cn } from '@/shared/lib/cn';
import { PAGE_CONTAINER } from '@/shared/ui/page';
import { ConversationList } from '@/widgets/chat-list';
import { ChatThread } from '@/widgets/chat-thread';

/** Chiều cao dưới header (h-14) — luồng tin cuộn bên trong, không cuộn cả trang. */
const FILL = 'h-[calc(100dvh-3.5rem)]';

/**
 * `/chat` và `/chat/[id]` (avatar-chat.md §7): < md hai màn toàn màn hình (danh sách HOẶC luồng); ≥ md hai cột (danh sách
 * + luồng). Mỗi hội thoại một `key` ⇒ state (trả lời, vạch chưa đọc) không lẫn sang hội thoại khác.
 */
export function ChatPage() {
  const { id } = useParams<{ id?: string }>();
  return (
    <main className={cn(PAGE_CONTAINER, FILL, 'grid gap-4 py-3 md:grid-cols-[20rem_1fr]')}>
      <div className={cn('min-h-0 overflow-y-auto', id && 'hidden md:block')}>
        <ConversationList activeId={id} />
      </div>
      <div
        className={cn(
          'min-h-0 flex-col rounded-card border border-border bg-surface',
          id ? 'flex' : 'hidden md:flex',
        )}
      >
        {id ? (
          <ChatThread key={id} convId={id} />
        ) : (
          <p className="m-auto text-sm text-text-muted">Chọn một cuộc trò chuyện để bắt đầu.</p>
        )}
      </div>
    </main>
  );
}
