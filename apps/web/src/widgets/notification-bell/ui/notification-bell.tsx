'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  notificationHref,
  notificationText,
  useNotifications,
  useUnreadCount,
} from '@/entities/notification';
import { useMarkAllRead, useMarkRead } from '@/features/notification-read';
import { cn } from '@/shared/lib/cn';
import { serverClock } from '@/shared/lib/server-clock';
import { Button } from '@/shared/ui/button';
import { Popover } from '@/shared/ui/popover';

const relative = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
function ago(iso: string): string {
  const min = Math.round((Date.parse(iso) - serverClock.now()) / 60_000);
  if (Math.abs(min) < 60) return relative.format(min, 'minute');
  const h = Math.round(min / 60);
  return Math.abs(h) < 24 ? relative.format(h, 'hour') : relative.format(Math.round(h / 24), 'day');
}

/** Chuông thông báo trên header (attendance-leave.md §6, ADR-123): số chưa đọc + 20 mới nhất. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount().data?.count ?? 0;
  const list = useNotifications(open);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const label = unread > 0 ? `Thông báo, ${unread} chưa đọc` : 'Thông báo';
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Thông báo"
      trigger={
        <button
          type="button"
          aria-label={label}
          className="relative inline-flex size-9 items-center justify-center rounded-control text-text hover:bg-bg-subtle"
        >
          <span aria-hidden="true">🔔</span>
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-danger-fg"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      }
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <h2 className="text-sm font-semibold">Thông báo</h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={unread === 0}
          loading={markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Đánh dấu đã đọc hết
        </Button>
      </div>
      {!list.data ? (
        <p role="status" className="px-2 py-3 text-text-muted">
          {list.isError ? 'Không tải được thông báo.' : 'Đang tải…'}
        </p>
      ) : list.data.length === 0 ? (
        <p className="px-2 py-3 text-text-muted">Chưa có thông báo.</p>
      ) : (
        <ul className="flex max-h-96 flex-col overflow-y-auto">
          {list.data.map((n) => (
            <li key={n.id}>
              <Link
                href={notificationHref(n)}
                // Tên đọc rõ ràng (các span cạnh nhau bị ghép dính chữ khi tính tên truy cập).
                aria-label={`${n.readAt === null ? 'Chưa đọc: ' : ''}${notificationText(n)}. ${ago(n.createdAt)}`}
                onClick={() => {
                  if (n.readAt === null) markRead.mutate(n.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex flex-col gap-0.5 rounded-control px-2 py-2 hover:bg-bg-subtle',
                  n.readAt === null && 'font-medium',
                )}
              >
                <span>
                  {n.readAt === null && <span className="sr-only">Chưa đọc: </span>}
                  {notificationText(n)}
                </span>
                <span className="text-xs font-normal text-text-muted">{ago(n.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
