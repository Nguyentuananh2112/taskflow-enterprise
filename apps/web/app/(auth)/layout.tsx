import type { ReactNode } from 'react';

import { GuestGate } from '@/app/gates';

// Màn khách: đã có phiên ⇒ GuestGate chuyển vào /w (frontend.md §2.1, §3.3).
export default function GuestLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <GuestGate>{children}</GuestGate>;
}
