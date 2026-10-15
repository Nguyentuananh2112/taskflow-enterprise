'use client';

import { useState } from 'react';

import { session } from '@/entities/session';
import { Button } from '@/shared/ui/button';

/** Đăng xuất thiết bị này — luôn kết thúc phiên kể cả khi request lỗi (frontend.md §3.3). */
export function LogoutButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() => {
        setPending(true);
        void session.logout();
      }}
    >
      Đăng xuất
    </Button>
  );
}
