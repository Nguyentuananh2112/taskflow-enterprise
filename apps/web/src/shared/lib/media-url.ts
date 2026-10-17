import { getRuntimeConfig } from '@/shared/config';

// Phòng thủ chiều sâu cho URL tệp do server trả (B soát T-071/T-072, L1/L2): chỉ dùng URL thuộc ĐÚNG origin API và đúng
// đường `…/media/<kind>/` (ADR-141). Mock / proxy / lỗi server trả `javascript:`, `data:`, `blob:` hay origin lạ ⇒ không
// điều hướng, không đặt vào <img>. Đóng an toàn: chưa có cấu hình / URL hỏng ⇒ false.

export type MediaKind = 'avatars' | 'chat';

export function isApiMediaUrl(url: string | null | undefined, kind: MediaKind): boolean {
  if (!url) return false;
  let api: URL;
  let target: URL;
  try {
    api = new URL(getRuntimeConfig().apiUrl);
    target = new URL(url);
  } catch {
    return false;
  }
  const base = api.pathname.replace(/\/$/, '');
  return target.origin === api.origin && target.pathname.startsWith(`${base}/media/${kind}/`);
}
