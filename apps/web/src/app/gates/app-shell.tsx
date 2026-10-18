import Link from 'next/link';
import type { ReactNode } from 'react';

import { PrivacyPrompt } from '@/features/privacy-ack';
import { PAGE_CONTAINER } from '@/shared/ui/page';

import { AppHeader } from '@/widgets/app-header';
import { ChatEntry } from '@/widgets/chat-entry';
import { NotificationBell } from '@/widgets/notification-bell';

import { RealtimeSessionEffects } from './realtime-session-effects';

/**
 * Khung khu đã đăng nhập: header + nội dung + chân trang (link Quyền riêng tư — T-075). Tầng app ráp các widget vào
 * header (FSD) và hộp thoại thông báo quyền riêng tư "lần đầu".
 */
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <RealtimeSessionEffects />
      <AppHeader
        actions={
          <>
            <ChatEntry />
            <NotificationBell />
          </>
        }
      />
      {children}
      <footer className="mt-auto border-t border-border">
        <div className={`${PAGE_CONTAINER} flex py-3 text-sm`}>
          <Link href="/privacy" className="text-text-muted underline hover:text-text">
            Quyền riêng tư
          </Link>
        </div>
      </footer>
      <PrivacyPrompt />
    </div>
  );
}
