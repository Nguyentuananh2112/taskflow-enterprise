import { useSyncExternalStore } from 'react';

/**
 * Token kích hoạt từ fragment `#t=…` (ADR-137 điều khoản 3–4): đọc MỘT lần cho mỗi lượt tải trang, giữ trong bộ nhớ (không
 * localStorage / sessionStorage) và `history.replaceState` xóa fragment NGAY — trước mọi request — token không nằm lại
 * trên thanh địa chỉ / lịch sử / ảnh chụp màn hình. Tải lại trang ⇒ mất token (đúng ý: "mở lại link trong tin nhắn").
 */
let captured: string | null | undefined;

function capture(): string | null {
  if (captured === undefined) {
    const raw = new URLSearchParams(window.location.hash.slice(1)).get('t');
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    captured = raw && raw.length > 0 ? raw : null;
  }
  return captured;
}

const subscribe = () => () => undefined; // fragment chỉ đọc một lần — không theo dõi đổi

/** `undefined` = chưa đọc (server render); `null` = trang mở không có token. */
export function useActivationToken(): string | null | undefined {
  return useSyncExternalStore(subscribe, capture, () => undefined);
}

/** Kích hoạt xong / test: quên token đã đọc (lượt mở `/activate` sau trong cùng tab đọc lại fragment mới). */
export function forgetActivationToken(): void {
  captured = undefined;
}
