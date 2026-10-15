import type { ReactNode } from 'react';

import { AppShell, AuthGate } from '@/app/gates';

// Khu đã đăng nhập: render phía client sau khi khôi phục phiên (ADR-026, frontend.md §2.1).
export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
