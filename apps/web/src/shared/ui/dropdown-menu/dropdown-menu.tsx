import { DropdownMenu as Menu } from 'radix-ui';

import { cn } from '@/shared/lib/cn';

// Menu thả xuống (Radix): phím mũi tên, Enter/Space, Esc, trả focus về nút mở; nội dung trong portal.

export type MenuItem = Readonly<{
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}>;

type Props = Readonly<{
  /** Tên truy cập của nút mở (nút chỉ có icon "⋯"). */
  label: string;
  items: readonly MenuItem[];
  className?: string;
}>;

export function DropdownMenu({ label, items, className }: Props) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label={label}
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-control text-text-muted hover:bg-bg-subtle',
          className,
        )}
      >
        <span aria-hidden="true">⋯</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
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
