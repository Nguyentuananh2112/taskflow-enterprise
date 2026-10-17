'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useChatUnread } from '@/entities/chat';

/** Badge gọn (E9): 1–9, quá 9 ⇒ "9+". */
export const badgeText = (n: number) => (n > 9 ? '9+' : String(n));

/**
 * ≥ md: icon "Trò chuyện" cạnh chuông (avatar-chat.md §7 E9) — badge riêng, KHÔNG dùng chuông thông báo (ADR-145).
 * < md: lối vào là mục "Trò chuyện" trong ☰ (chấm trên ☰) + ô ở trang chính.
 */
export function ChatEntry() {
  const unread = useChatUnread().data ?? 0;
  const here = usePathname().startsWith('/chat');
  return (
    <Link
      href="/chat"
      aria-label={unread > 0 ? `Trò chuyện, ${unread} tin chưa đọc` : 'Trò chuyện'}
      aria-current={here ? 'page' : undefined}
      className="relative hidden size-9 items-center justify-center rounded-control text-text hover:bg-bg-subtle aria-[current=page]:bg-bg-subtle md:inline-flex"
    >
      <span aria-hidden="true">💬</span>
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-danger-fg"
        >
          {badgeText(unread)}
        </span>
      )}
    </Link>
  );
}
