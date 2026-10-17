'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { session, useSession } from '@/entities/session';
import { safeNextPath } from '@/shared/lib/safe-next-path';

import { LogoutPendingAlert } from './logout-pending-alert';

/**
 * Cổng màn khách (/login — frontend.md §3.3; Mốc 3.5 không còn /register): thử khôi phục phiên một lần; đã đăng nhập
 * (sẵn có, vừa đăng nhập/đăng ký, hoặc tab khác vừa đăng nhập) ⇒ chuyển tới `?next=` an toàn hoặc
 * /w. Đây là chỗ DUY NHẤT điều hướng sau đăng nhập. Form vẫn hiện trong lúc khôi phục (không chặn).
 */
export function GuestGate({ children }: Readonly<{ children: ReactNode }>) {
  // T-044 S2a: mở khôi phục phiên NGAY ở lượt render đầu (trước effect bên dưới); chỉ route có gate — landing / 404
  // không gửi refresh (review E). Tác dụng phụ có chủ ý trong render: idempotent, không đổi store (session.prestart).
  if (typeof window !== 'undefined') session.prestart();
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

  return (
    <>
      <LogoutPendingAlert />
      {children}
    </>
  );
}
