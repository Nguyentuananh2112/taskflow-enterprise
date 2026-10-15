import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

// Nền nhạt pha từ màu token (color-mix) + chữ màu token ⇒ đủ tương phản ở cả sáng và tối.
const TONES = {
  neutral: 'text-text-muted bg-[color-mix(in_srgb,var(--text-muted)_14%,transparent)]',
  primary: 'text-primary bg-[color-mix(in_srgb,var(--primary)_14%,transparent)]',
  success: 'text-success bg-[color-mix(in_srgb,var(--success)_14%,transparent)]',
  warning: 'text-warning bg-[color-mix(in_srgb,var(--warning)_16%,transparent)]',
  danger: 'text-danger bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]',
} as const;

export type BadgeTone = keyof typeof TONES;

type Props = Readonly<{
  tone?: BadgeTone;
  /** Icon trang trí đặt trước chữ — màu không bao giờ là tín hiệu duy nhất (frontend.md §6.1). */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}>;

export function Badge({ tone = 'neutral', icon, className, children }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
