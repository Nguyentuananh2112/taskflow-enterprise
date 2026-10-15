import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

const TONES = {
  danger: 'border-danger text-danger bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]',
  success: 'border-success text-success bg-[color-mix(in_srgb,var(--success)_8%,transparent)]',
  info: 'border-primary text-text bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]',
} as const;

type Props = Readonly<{
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}>;

/**
 * Khối thông báo trong trang (vd lỗi gốc của form). `danger` dùng `role="alert"` để trình đọc màn
 * hình đọc ngay khi xuất hiện; tone khác dùng `role="status"` (không ngắt lời).
 */
export function Alert({ tone = 'danger', children, className }: Props) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-control border-l-4 px-3 py-2 text-sm', TONES[tone], className)}
    >
      {children}
    </div>
  );
}
