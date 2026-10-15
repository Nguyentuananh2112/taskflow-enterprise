'use client';

import { useState } from 'react';

import { session } from '@/entities/session';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

/**
 * Đăng xuất thiết bị này — phiên local luôn kết thúc (frontend.md §3.3). Server chưa xác nhận (lỗi
 * mạng/5xx) ⇒ báo rõ, không giả vờ thành công (T-029 H2); màn đăng nhập có nút thử lại.
 */
export function LogoutButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() => {
        setPending(true);
        void session.logout().then((confirmed) => {
          if (confirmed) return;
          toast({
            title: 'Chưa đăng xuất được trên máy chủ',
            description: 'Phiên trên máy chủ có thể vẫn còn. Hãy bấm "Thử lại đăng xuất".',
            tone: 'error',
          });
        });
      }}
    >
      Đăng xuất
    </Button>
  );
}
