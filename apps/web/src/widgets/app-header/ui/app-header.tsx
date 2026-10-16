'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useSession } from '@/entities/session';
import { LogoutButton } from '@/features/auth-logout';
import { cn } from '@/shared/lib/cn';
import { Avatar } from '@/shared/ui/avatar';
import { PAGE_CONTAINER } from '@/shared/ui/page';

import { HeaderAttendance } from './header-attendance';

type Props = Readonly<{
  /** Ô do tầng app ráp vào (vd chuông thông báo) — widget không import widget khác (FSD). */
  actions?: ReactNode;
}>;

/** Thanh trên của khu đã đăng nhập: logo, người dùng, Tài khoản, Đăng xuất. */
export function AppHeader({ actions }: Props) {
  const { user } = useSession();
  return (
    <header className="border-b border-border bg-surface">
      <div className={cn(PAGE_CONTAINER, 'flex h-14 items-center gap-4')}>
        <Link href="/w" className="text-base font-semibold text-text">
          TaskFlow
        </Link>
        <nav aria-label="Tài khoản" className="ml-auto flex items-center gap-1 sm:gap-2">
          <HeaderAttendance />
          {actions}
          {user && (
            // Màn hẹp (360) không đủ chỗ cho avatar + chuông + 2 nút ⇒ ẩn avatar (tên vẫn ở trang Tài khoản).
            <span className="hidden items-center gap-2 text-sm sm:flex">
              <Avatar name={user.fullName} colorKey={user.id} size="sm" decorative />
              <span className="hidden sm:inline">{user.fullName}</span>
            </span>
          )}
          <Link
            href="/account"
            className="rounded-control px-2 py-1.5 text-sm whitespace-nowrap text-text hover:bg-bg-subtle sm:px-3"
          >
            Tài khoản
          </Link>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}
