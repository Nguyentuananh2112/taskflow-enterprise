'use client';

import Link from 'next/link';

import { useChatUnread } from '@/entities/chat';

import { badgeText } from './chat-entry';

/**
 * < md: ô "Trò chuyện" ở trang chính `/w` (avatar-chat.md §7 E9) — ≥ md đã có icon cạnh chuông nên ẩn. Cùng nhãn với icon
 * (mỗi bề rộng màn chỉ một cái hiện).
 */
export function ChatHomeTile() {
  const unread = useChatUnread().data ?? 0;
  return (
    <Link
      href="/chat"
      aria-label={unread > 0 ? `Trò chuyện, ${unread} tin chưa đọc` : 'Trò chuyện'}
      className="flex min-h-12 items-center gap-3 rounded-card border border-border bg-surface px-4 text-sm font-medium hover:bg-bg-subtle md:hidden"
    >
      <span aria-hidden="true">💬</span>
      Trò chuyện
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="ml-auto min-w-6 rounded-full bg-danger px-2 text-center text-xs leading-6 text-danger-fg"
        >
          {badgeText(unread)}
        </span>
      )}
    </Link>
  );
}
