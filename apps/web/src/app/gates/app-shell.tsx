import type { ReactNode } from 'react';

import { AppHeader } from '@/widgets/app-header';

/** Khung khu đã đăng nhập: header + nội dung. */
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      {children}
    </div>
  );
}
