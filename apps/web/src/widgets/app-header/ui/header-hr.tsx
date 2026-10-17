'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useCompanyPermission } from '@/entities/session';

/**
 * Lối vào "Nhân sự" trên header ở mọi trang — hiện khi có `hr:manage` cấp công ty (`/auth/me`, ADR-135). Màn hẹp ẩn
 * (T-065a thay bằng menu ☰ + khối "Việc quản lý" ở trang chính).
 */
export function HeaderHr() {
  const allowed = useCompanyPermission().can('hr:manage');
  const current = usePathname() === '/hr';
  if (!allowed) return null;
  return (
    <Link
      href="/hr"
      aria-current={current ? 'page' : undefined}
      className="hidden rounded-control px-3 py-1.5 text-sm whitespace-nowrap text-text hover:bg-bg-subtle aria-[current=page]:font-medium sm:inline-flex"
    >
      Nhân sự
    </Link>
  );
}
