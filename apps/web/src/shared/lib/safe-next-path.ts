/**
 * `?next=` sau đăng nhập (frontend.md §3.3): chỉ nhận đường dẫn tương đối cùng origin — bắt đầu bằng
 * một `/`, không `//` hay `/\` (trình duyệt hiểu là URL khác host), không ký tự điều khiển.
 * Sai ⇒ `fallback`. Chống open redirect.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/w'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\'))
    return fallback;
  // eslint-disable-next-line no-control-regex -- chặn chính xác ký tự điều khiển
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  // Đối chiếu lại bằng URL parser: kết quả phải cùng origin giả định.
  const base = 'http://taskflow.invalid';
  const url = new URL(raw, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
}
