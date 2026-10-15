'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { session, useSession } from '@/entities/session';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Cổng khu đã đăng nhập (frontend.md §3.3): khôi phục phiên bằng /auth/refresh, KHÔNG render route
 * con trước khi biết phiên. Khách ⇒ /login?next=…; lỗi mạng ⇒ màn "Không kết nối được" (không đẩy về
 * /login).
 */
export function AuthGate({ children }: Readonly<{ children: ReactNode }>) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    void session.bootstrap();
  }, []);

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status === 'authenticated') return children;
  if (status === 'unreachable') {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Không kết nối được máy chủ"
          description="Kiểm tra kết nối mạng rồi thử lại. Phiên đăng nhập của bạn vẫn được giữ."
          action={<Button onClick={() => void session.bootstrap()}>Thử lại</Button>}
        />
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center">
      <Spinner label="Đang tải phiên đăng nhập" />
    </main>
  );
}
