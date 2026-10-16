import { useState, type KeyboardEvent, type PointerEvent } from 'react';

import { RadixMenu, triggerClass, type MenuProps } from './radix-menu';

export type { MenuItem } from './radix-menu';

const OPEN_KEYS = new Set(['Enter', ' ', 'ArrowDown']);

/**
 * Menu "⋯" mount LƯỜI (perf/board-mount bậc 1): board 500 thẻ không dựng 500 Root Radix. Trước lần
 * tương tác đầu chỉ là một `<button>` thật — cùng tên truy cập, `aria-haspopup="menu"`,
 * `aria-expanded="false"`, cùng vị trí tab ⇒ axe / trình đọc màn hình không đổi. Nhấn chuột trái
 * (pointerdown, như Radix) hoặc Enter / Space / ArrowDown ⇒ thay bằng menu Radix ĐÃ MỞ; từ đó giữ
 * Radix cho thẻ này (đóng ⇒ focus về nút như cũ).
 */
export function DropdownMenu(props: MenuProps) {
  const [openedBy, setOpenedBy] = useState<'pointer' | 'keyboard' | null>(null);
  if (openedBy) return <RadixMenu {...props} openedBy={openedBy} />;

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.ctrlKey) return;
    event.preventDefault(); // như Radix: không để focus nhảy trước khi menu mở
    setOpenedBy('pointer');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!OPEN_KEYS.has(event.key)) return;
    event.preventDefault();
    setOpenedBy('keyboard');
  };
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-haspopup="menu"
      aria-expanded={false}
      className={triggerClass(props.className)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true">⋯</span>
    </button>
  );
}
