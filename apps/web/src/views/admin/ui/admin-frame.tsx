'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useCompanyPermission } from '@/entities/session';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

/** Khung chung các trang Quản trị: chặn khi thiếu `company:admin` (câu + lối về), nút quay lại `/admin`. */
export function AdminFrame({
  title,
  back = true,
  children,
}: Readonly<{ title: string; back?: boolean; children: ReactNode }>) {
  const { company, can } = useCompanyPermission();
  if (company !== null && !can('company:admin')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Chỉ Quản trị viên mở được trang này"
          action={
            <Link href="/w" className="text-sm underline">
              Về trang chính
            </Link>
          }
        />
      </main>
    );
  }
  return (
    <PageMain className="max-w-4xl gap-4">
      {back && (
        <Link href="/admin" className="self-start text-sm text-text-muted hover:underline">
          ‹ Quản trị
        </Link>
      )}
      <h1 className="text-xl font-semibold">{title}</h1>
      {company && children}
    </PageMain>
  );
}

export function Loading({ label }: Readonly<{ label: string }>) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="grid gap-2">
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  );
}
