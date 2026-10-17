import type { ConversationDto } from '@taskflow/contracts/chat';
import Link from 'next/link';

import { conversationTitle } from '@/entities/chat';
import { cn } from '@/shared/lib/cn';
import { Avatar } from '@/shared/ui/avatar';

const clock = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' });

/** Giờ nếu hôm nay, ngày/tháng nếu khác ngày. */
export function shortTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString() ? clock.format(d) : day.format(d);
}

/** Dòng xem trước: "Bạn: …", tin đã xóa, chỉ tệp. Văn bản thuần. */
export function previewText(c: ConversationDto, me: string | undefined): string {
  const last = c.lastMessage;
  if (!last) return 'Chưa có tin nhắn';
  if (last.deleted) return 'Tin nhắn đã bị xóa';
  const who =
    last.sender.id === me ? 'Bạn: ' : c.kind === 'DIRECT' ? '' : `${last.sender.fullName}: `;
  return who + (last.bodyPreview ?? `📎 ${last.attachmentCount} tệp`);
}

type Props = Readonly<{ c: ConversationDto; me: string | undefined; active: boolean }>;

/** Một dòng danh sách: nhãn đọc rõ số chưa đọc + tắt tiếng (không chỉ dựa vào màu). */
export function ConversationItem({ c, me, active }: Props) {
  const title = conversationTitle(c);
  const label = [
    title,
    c.unread > 0 ? `${c.unread} tin chưa đọc` : null,
    c.muted ? 'đã tắt tiếng' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li>
      <Link
        href={`/chat/${c.id}`}
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        className={cn(
          'flex min-h-14 items-center gap-3 rounded-control px-3 py-2 hover:bg-bg-subtle',
          active && 'bg-bg-subtle',
        )}
      >
        <Avatar
          name={c.kind === 'DIRECT' ? title : (c.title ?? title)}
          colorKey={c.peer?.id ?? c.id}
          src={c.peer?.avatarUrl}
          decorative
          loading="lazy"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className={cn('truncate text-sm', c.unread > 0 && 'font-semibold')}>{title}</span>
            {c.muted && (
              <span aria-hidden="true" className="text-xs">
                🔕
              </span>
            )}
            {c.lastMessageAt && (
              <span className="ml-auto shrink-0 text-xs text-text-muted">
                {shortTime(c.lastMessageAt)}
              </span>
            )}
          </span>
          <span className="flex items-center gap-2">
            <span className="truncate text-xs text-text-muted">{previewText(c, me)}</span>
            {c.unread > 0 && (
              <span
                aria-hidden="true"
                className="ml-auto min-w-5 shrink-0 rounded-full bg-danger px-1.5 text-center text-[11px] leading-5 text-danger-fg"
              >
                {c.unread > 9 ? '9+' : c.unread}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
