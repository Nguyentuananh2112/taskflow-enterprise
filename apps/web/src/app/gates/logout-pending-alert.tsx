'use client';

import { useState } from 'react';

import { session, useLogoutPending } from '@/entities/session';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

/** Đăng xuất ở server chưa xác nhận (T-029 H2): cảnh báo + thử lại thay vì im lặng. */
export function LogoutPendingAlert() {
  const pending = useLogoutPending();
  const [retrying, setRetrying] = useState(false);
  if (!pending) return null;
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-6">
      <Alert>
        <p>Chưa đăng xuất được trên máy chủ — phiên có thể vẫn còn hiệu lực.</p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          loading={retrying}
          onClick={() => {
            setRetrying(true);
            void session.retryLogout().finally(() => setRetrying(false));
          }}
        >
          Thử lại đăng xuất
        </Button>
      </Alert>
    </div>
  );
}
