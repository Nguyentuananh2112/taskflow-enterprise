'use client';

import type { CompanyPermission } from '@taskflow/contracts/company';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { useCompanyPermission } from '@/entities/session';
import { cn } from '@/shared/lib/cn';

type Item = Readonly<{
  href: string;
  label: string;
  /** Không có ⇒ ai thuộc công ty cũng thấy. */
  needs?: CompanyPermission;
  /** Việc quản lý — hiện cả trên header ≥ md (việc cá nhân chỉ ở menu ☰ + lối tắt trang chính). */
  manage?: boolean;
}>;

const ITEMS: readonly Item[] = [
  { href: '/w', label: 'Trang chính' },
  { href: '/attendance', label: 'Bảng công của tôi', needs: 'attendance:self' },
  { href: '/leave', label: 'Nghỉ phép', needs: 'leave:self' },
  { href: '/my-profile', label: 'Hồ sơ của tôi', needs: 'profile:self' },
  // TẠM: `payslip:self` (T-048 B) chưa có — cùng tập người với `attendance:self` (chỉ nhân viên).
  { href: '/payslips', label: 'Phiếu lương', needs: 'attendance:self' },
  { href: '/hr', label: 'Nhân sự', needs: 'hr:manage', manage: true },
  { href: '/payroll', label: 'Bảng lương', needs: 'payroll:manage', manage: true },
  { href: '/admin', label: 'Quản trị', needs: 'company:admin', manage: true },
];

const current = (pathname: string, href: string) =>
  href === '/w' ? pathname === '/w' : pathname === href || pathname.startsWith(`${href}/`);

const LINK =
  'rounded-control px-3 py-1.5 text-sm whitespace-nowrap text-text hover:bg-bg-subtle aria-[current=page]:font-semibold';

/** Mục theo quyền công ty (`/auth/me`, server tính); chưa tải xong ⇒ chỉ "Trang chính", không đoán. */
function useItems() {
  const { can } = useCompanyPermission();
  return { items: ITEMS.filter((i) => !i.needs || can(i.needs)), pathname: usePathname() };
}

/** ≥ md: hàng link trên header — Trang chính + việc quản lý theo quyền (ADR-139, E A4). */
export function CompanyLinks() {
  const { items, pathname } = useItems();
  return (
    <nav aria-label="Công ty" className="hidden items-center gap-1 md:flex">
      {items
        .filter((i) => i.href === '/w' || i.manage)
        .map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={current(pathname, i.href) ? 'page' : undefined}
            className={LINK}
          >
            {i.label}
          </Link>
        ))}
    </nav>
  );
}

/**
 * < md: nút ☰ mở danh sách đủ mục (kể cả Bảng công, Nghỉ phép) ngay dưới header — ô chạm cao 48 px; Esc / chọn
 * mục ⇒ đóng (E A1).
 */
export function CompanyMenu() {
  const { items, pathname } = useItems();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Đổi trang (bấm một mục) ⇒ đóng menu.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-10 items-center justify-center rounded-control text-text hover:bg-bg-subtle md:hidden"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          {open ? '✕' : '☰'}
        </span>
        <span className="sr-only">Menu</span>
      </button>
      {open && (
        <nav
          id={panelId}
          aria-label="Menu"
          className="absolute inset-x-0 top-14 z-40 border-b border-border bg-surface shadow-card md:hidden"
        >
          <ul className="flex flex-col py-1">
            {items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={current(pathname, i.href) ? 'page' : undefined}
                  className={cn(LINK, 'flex min-h-12 items-center rounded-none px-4 text-base')}
                >
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}
