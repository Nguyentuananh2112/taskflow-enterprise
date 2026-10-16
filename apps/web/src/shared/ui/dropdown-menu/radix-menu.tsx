import { DropdownMenu as Menu } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/shared/lib/cn';

// Menu thả xuống (Radix): phím mũi tên, Enter/Space, Esc, trả focus về nút mở; nội dung trong portal.

export type MenuItem = Readonly<{
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}>;

export type MenuProps = Readonly<{
  /** Tên truy cập của nút mở (nút chỉ có icon "⋯"). */
  label: string;
  items: readonly MenuItem[];
  className?: string;
}>;

export const triggerClass = (className?: string) =>
  cn(
    'inline-flex size-7 items-center justify-center rounded-control text-text-muted hover:bg-bg-subtle',
    className,
  );

type Props = MenuProps &
  Readonly<{
    /**
     * Mount ĐÃ MỞ vì người dùng vừa tương tác với nút nhẹ (dropdown-menu.tsx). `keyboard` ⇒ focus mục
     * đầu như Radix khi mở bằng phím (cờ "đang dùng phím" của Radix chưa kịp bật vì phím đến trước khi
     * Root mount).
     */
    openedBy: 'pointer' | 'keyboard';
  }>;

export function RadixMenu({ label, items, className, openedBy }: Props) {
  const [open, setOpen] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openedBy !== 'keyboard') return;
    // Sau auto-focus của Radix (focus vào content) ⇒ chuyển sang mục đầu, như khi Radix mở bằng phím.
    const id = requestAnimationFrame(() =>
      contentRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
        ?.focus(),
    );
    return () => cancelAnimationFrame(id);
  }, [openedBy]);
  return (
    <Menu.Root modal={false} open={open} onOpenChange={setOpen}>
      <Menu.Trigger aria-label={label} className={triggerClass(className)}>
        <span aria-hidden="true">⋯</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          ref={contentRef}
          className="z-50 min-w-48 rounded-control border border-border bg-surface p-1 text-sm text-text shadow-raised"
        >
          {items.map((item) => (
            <Menu.Item
              key={item.key}
              disabled={item.disabled ?? false}
              onSelect={item.onSelect}
              className={cn(
                'cursor-pointer rounded-control px-2 py-1.5 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-bg-subtle',
                item.tone === 'danger' && 'text-danger',
              )}
            >
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
