import type { ReactNode } from 'react';

import { AppHeader } from '@/widgets/app-header';
import { ChatEntry } from '@/widgets/chat-entry';
import { NotificationBell } from '@/widgets/notification-bell';

import { RealtimeSessionEffects } from './realtime-session-effects';

/** Khung khu đã đăng nhập: header + nội dung. Tầng app ráp các widget vào header (FSD). */
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
    </div>
  );
}
