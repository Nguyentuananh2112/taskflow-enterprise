'use client';

import Link from 'next/link';

import { useSession } from '@/entities/session';
import { LogoutButton } from '@/features/auth-logout';
import { Avatar } from '@/shared/ui/avatar';

/** Thanh trên của khu đã đăng nhập: logo, người dùng, Tài khoản, Đăng xuất. */
export function AppHeader() {
  const { user } = useSession();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <Link href="/w" className="text-base font-semibold text-text">
          TaskFlow
        </Link>
        <nav aria-label="Tài khoản" className="ml-auto flex items-center gap-2">
          {user && (
            <span className="flex items-center gap-2 text-sm">
              <Avatar name={user.fullName} colorKey={user.id} size="sm" decorative />
              <span className="hidden sm:inline">{user.fullName}</span>
            </span>
          )}
          <Link
            href="/account"
            className="rounded-control px-3 py-1.5 text-sm text-text hover:bg-bg-subtle"
          >
            Tài khoản
          </Link>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}
