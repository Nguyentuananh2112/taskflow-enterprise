'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { session, useSession } from '@/entities/session';
import { safeNextPath } from '@/shared/lib/safe-next-path';

/**
 * Cổng màn khách (/login, /register — frontend.md §3.3): thử khôi phục phiên một lần; đã đăng nhập
 * (sẵn có, vừa đăng nhập/đăng ký, hoặc tab khác vừa đăng nhập) ⇒ chuyển tới `?next=` an toàn hoặc
 * /w. Đây là chỗ DUY NHẤT điều hướng sau đăng nhập. Form vẫn hiện trong lúc khôi phục (không chặn).
 */
export function GuestGate({ children }: Readonly<{ children: ReactNode }>) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    void session.bootstrap();
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const next = new URLSearchParams(window.location.search).get('next');
    router.replace(safeNextPath(next));
  }, [status, router]);

  return children;
}
