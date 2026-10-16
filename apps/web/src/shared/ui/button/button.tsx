import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';
import { Spinner } from '@/shared/ui/spinner';

const VARIANTS = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'border border-border bg-surface text-text hover:bg-bg-subtle',
  ghost: 'text-text hover:bg-bg-subtle',
  danger: 'bg-danger text-danger-fg hover:opacity-90',
} as const;

const SIZES = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm' } as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  Readonly<{
    variant?: keyof typeof VARIANTS;
    size?: keyof typeof SIZES;
    /** Đang chờ request: khóa nút, hiện spinner, `aria-busy`. */
    loading?: boolean;
    /** Render phần tử con (vd `<Link>`) với style của Button — Radix Slot. */
    asChild?: boolean;
    children: ReactNode;
  }>;

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  asChild = false,
  disabled,
  type,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = cn(
    'inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
  if (asChild) {
    return (
      <Slot.Root className={classes} {...rest}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      // Mặc định type="button" để không vô tình submit form.
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
    >
      {loading && <Spinner size="sm" label={null} />}
      {children}
    </button>
  );
}
