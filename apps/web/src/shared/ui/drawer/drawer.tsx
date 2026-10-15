import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

// Drawer phải (frontend.md §1.1: chi tiết task). Cùng primitive với Dialog nên có đủ focus trap,
// Esc, trả focus. Màn < 768px chiếm toàn màn hình.

type Props = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Phần đầu bên phải tiêu đề (vd nút "Sao chép link"). */
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
}>;

export function Drawer({ open, onOpenChange, title, headerActions, children, className }: Props) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface text-text shadow-raised md:w-[480px]',
            className,
          )}
        >
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <RadixDialog.Title className="flex-1 truncate text-base font-semibold">
              {title}
            </RadixDialog.Title>
            {headerActions}
            <RadixDialog.Close
              className="inline-flex size-8 items-center justify-center rounded-control text-text-muted hover:bg-bg-subtle"
              aria-label="Đóng"
            >
              <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </RadixDialog.Close>
          </header>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
