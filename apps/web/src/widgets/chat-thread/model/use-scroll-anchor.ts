import { useLayoutEffect, useRef } from 'react';

// Cuộn luồng tin (avatar-chat.md §7 E8): mở ⇒ xuống đáy; chèn trang CŨ phía trên ⇒ bù `scrollHeight` (giữ nguyên tin
// đang nhìn); tin mới ⇒ bám đáy nếu đang ở gần đáy hoặc tin của mình — không giật khi đang đọc tin cũ.

const NEAR_BOTTOM_PX = 80;

type Input = Readonly<{
  /** Số trang đã tải (tăng ⇒ vừa chèn trang cũ). */
  pages: number;
  /** id tin mới nhất. */
  newestId: string | undefined;
  newestIsMine: boolean;
}>;

/** Đặt vị trí cuộn (tách khỏi hook — phần tử DOM, không phải state React). */
function scrollTo(el: HTMLElement, top: number): void {
  el.scrollTop = top;
}

/** Trả `ref` gắn vào khung cuộn + `onScroll`. */
export function useScrollAnchor({ pages, newestId, newestIsMine }: Input) {
  const box = useRef<HTMLDivElement>(null);
  const prev = useRef({
    pages: 0,
    newestId: undefined as string | undefined,
    fromBottom: 0,
    atBottom: true,
  });

  // Ghi vị trí TRƯỚC mỗi lần render kế tiếp (sau khi người dùng cuộn).
  const remember = () => {
    const el = box.current;
    if (!el) return;
    prev.current.fromBottom = el.scrollHeight - el.scrollTop;
    prev.current.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const before = prev.current;
    if (before.pages === 0 && pages > 0) {
      scrollTo(el, el.scrollHeight); // lần đầu mở
    } else if (pages > before.pages) {
      scrollTo(el, el.scrollHeight - before.fromBottom); // chèn trang cũ phía trên ⇒ giữ chỗ
    } else if (newestId !== before.newestId && (before.atBottom || newestIsMine)) {
      scrollTo(el, el.scrollHeight);
    }
    prev.current = { ...prev.current, pages, newestId };
    remember();
  });

  return { ref: box, onScroll: remember };
}
