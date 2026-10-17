import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

// Radix Dialog: focus trap, Esc đóng, trả focus về nút mở, aria-modal, khóa cuộn nền.
// Style chèn bởi khóa cuộn mang nonce nhờ setNonce ở src/app/providers (CSP W-CSP-2).

type Props = Readonly<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Phần tử mở dialog (thường là <Button>) — bọc bằng Trigger asChild. */
  trigger?: ReactNode;
  /** Bắt buộc: tiêu đề là tên truy cập của dialog. */
  title: string;
  description?: string;
  children?: ReactNode;
  /** Hàng nút cuối (Hủy / Xác nhận). */
  footer?: ReactNode;
  className?: string;
  /** Ghi đè cỡ chữ tiêu đề (vd ngày trong chi tiết ngày in to hơn). */
  titleClassName?: string;
}>;

export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  className,
  titleClassName,
}: Props) {
  return (
    <RadixDialog.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
            'flex-col gap-4 overflow-y-auto rounded-card bg-surface p-6 text-text shadow-raised',
            className,
          )}
        >
          <div className="flex flex-col gap-1">
            <RadixDialog.Title className={cn('text-lg font-semibold', titleClassName)}>
              {title}
            </RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="text-sm text-text-muted">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          {children}
          {footer && <div className="flex justify-end gap-2">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Nút đóng dialog — bọc phần tử con (vd <Button variant="secondary">Hủy</Button>). */
export function DialogClose({ children }: Readonly<{ children: ReactNode }>) {
  return <RadixDialog.Close asChild>{children}</RadixDialog.Close>;
}
