'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { RateLimitedRetry, session, useSession } from '@/entities/session';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Cổng khu đã đăng nhập (frontend.md §3.3): khôi phục phiên bằng /auth/refresh, KHÔNG render route
 * con trước khi biết phiên. Khách ⇒ /login?next=…; lỗi mạng ⇒ màn "Không kết nối được" (không đẩy về
 * /login).
 */
export function AuthGate({ children }: Readonly<{ children: ReactNode }>) {
  // T-044 S2a: mở khôi phục phiên NGAY ở lượt render đầu (trước effect bên dưới); chỉ route có gate — landing / 404
  // không gửi refresh (review E). Tác dụng phụ có chủ ý trong render: idempotent, không đổi store (session.prestart).
  if (typeof window !== 'undefined') session.prestart();
  const { status, retryAt } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    void session.bootstrap();
  }, []);

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status === 'authenticated') return children;
  if (status === 'rate_limited') {
    // Lỗi #5: 429 khi khôi phục phiên ≠ mất mạng — đếm ngược theo server rồi tự thử lại.
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <RateLimitedRetry retryAt={retryAt ?? 0} />
      </main>
    );
  }
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
