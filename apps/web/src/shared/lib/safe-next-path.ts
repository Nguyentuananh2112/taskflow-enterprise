/**
 * Khu vực được phép quay về sau đăng nhập (segment đầu của path). Route mới cần `?next=` ⇒ thêm vào
 * đây có chủ đích — whitelist chặn cả những dạng vượt rào chưa ai nghĩ ra.
 */
const ALLOWED_ROOTS = new Set(['w', 'account']);

const BASE = 'http://taskflow.invalid';

/**
 * `?next=` sau đăng nhập (frontend.md §3.3): chỉ nhận đường dẫn tương đối cùng origin. Chống open
 * redirect (T-029 H1): KHÔNG chỉ kiểm chuỗi thô — dot-segment (`/..//evil.com`, `/%2e//evil.com`)
 * và `\` được parser chuẩn hóa thành `//evil.com`, trình duyệt hiểu là host khác. Vì vậy kiểm lại
 * chính KẾT QUẢ sau chuẩn hóa (không bắt đầu bằng `//` hay `/\`) và segment đầu phải thuộc
 * whitelist. Sai ⇒ `fallback`.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/w'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  // eslint-disable-next-line no-control-regex -- chặn chính xác ký tự điều khiển
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  const result = `${url.pathname}${url.search}${url.hash}`;
  if (url.origin !== BASE || !result.startsWith('/') || /^\/[/\\]/.test(result)) return fallback;
  const root = url.pathname.split('/')[1] ?? '';
  return ALLOWED_ROOTS.has(root) ? result : fallback;
}
