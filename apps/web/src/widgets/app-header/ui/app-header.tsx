'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useCompanyPermission, useSession } from '@/entities/session';
import { LogoutButton } from '@/features/auth-logout';
import { cn } from '@/shared/lib/cn';
import { Avatar } from '@/shared/ui/avatar';
import { PAGE_CONTAINER } from '@/shared/ui/page';

import { CompanyLinks, CompanyMenu } from './company-nav';
import { HeaderAttendance } from './header-attendance';

type Props = Readonly<{
  /** Ô do tầng app ráp vào (vd chuông thông báo) — widget không import widget khác (FSD). */
  actions?: ReactNode;
}>;

/**
 * Thanh trên của khu đã đăng nhập, MỌI trang (ADR-139): ☰ / menu công ty, logo + tên công ty (về trang chính), nút
 * Vào/Ra gọn, chuông, người dùng, Tài khoản, Đăng xuất.
 */
export function AppHeader({ actions }: Props) {
  const { user } = useSession();
  const companyName = useCompanyPermission().company?.name;
  return (
    <header className="relative border-b border-border bg-surface">
      <div className={cn(PAGE_CONTAINER, 'flex h-14 items-center gap-2 sm:gap-4')}>
        <CompanyMenu />
        <Link href="/w" className="flex min-w-0 items-baseline gap-2 text-text">
          <span className="text-base font-semibold">TaskFlow</span>
          {companyName && (
            <span className="hidden max-w-48 truncate text-sm text-text-muted lg:inline">
              {companyName}
            </span>
          )}
        </Link>
        <CompanyLinks />
        <nav aria-label="Tài khoản" className="ml-auto flex items-center gap-1 sm:gap-2">
          <HeaderAttendance />
          {actions}
          {user && (
            // Màn hẹp (360) không đủ chỗ cho avatar + chuông + 2 nút ⇒ ẩn avatar (tên vẫn ở trang Tài khoản).
            <span className="hidden items-center gap-2 text-sm sm:flex">
              <Avatar
                name={user.fullName}
                colorKey={user.id}
                src={user.avatarUrl}
                size="sm"
                decorative
              />
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
