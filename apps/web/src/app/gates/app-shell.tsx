import type { ReactNode } from 'react';

import { AppHeader } from '@/widgets/app-header';

import { RealtimeSessionEffects } from './realtime-session-effects';

/** Khung khu đã đăng nhập: header + nội dung. */
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <RealtimeSessionEffects />
      <AppHeader />
      {children}
    </div>
  );
}
