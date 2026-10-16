'use client';

import { Popover as RadixPopover } from 'radix-ui';
import type { ReactNode } from 'react';

type Props = Readonly<{
  /** Nút mở — đã có tên truy cập riêng (vd "Thông báo, 3 chưa đọc"). */
  trigger: ReactNode;
  /** Tên của hộp nổi (`aria-label` của nội dung, role=dialog). */
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}>;

/**
 * Hộp nổi gắn với nút (Radix Popover): Esc / bấm ra ngoài đóng, trả focus về nút, nội dung trong
 * portal. Dùng cho danh sách ngắn có link/nút (chuông thông báo) — khác DropdownMenu (chỉ mục chọn).
 */
export function Popover({ trigger, label, open, onOpenChange, children }: Props) {
  return (
    <RadixPopover.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-label={label}
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-[min(24rem,calc(100vw-1rem))] rounded-card border border-border bg-surface p-2 text-sm text-text shadow-raised"
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export const PopoverClose = RadixPopover.Close;
