/**
 * Chữ cái đầu kiểu Việt: "Nguyễn Văn An" → "NA" (họ + tên, không lấy tên đệm).
 * Giữ dấu (chữ "Đ" vẫn là "Đ"), viết hoa theo locale vi.
 */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const pick = (w: string) => Array.from(w)[0] ?? '';
  return (pick(first) + (last ? pick(last) : '')).toLocaleUpperCase('vi');
}

/**
 * Bảng nền avatar CỐ ĐỊNH (class Tailwind, không dùng `style=`): thuộc tính style trong HTML do server
 * render bị CSP `style-src 'nonce-…'` chặn (W-CSP-2). Mọi màu đạt tương phản ≥ 4.5:1 với chữ trắng — có test.
 */
export const AVATAR_COLORS = [
  { className: 'bg-[#1d4ed8]', hex: '#1d4ed8' },
  { className: 'bg-[#047857]', hex: '#047857' },
  { className: 'bg-[#b45309]', hex: '#b45309' },
  { className: 'bg-[#be123c]', hex: '#be123c' },
  { className: 'bg-[#6d28d9]', hex: '#6d28d9' },
  { className: 'bg-[#0e7490]', hex: '#0e7490' },
  { className: 'bg-[#4d7c0f]', hex: '#4d7c0f' },
  { className: 'bg-[#a21caf]', hex: '#a21caf' },
] as const;

/** Chỉ số màu ổn định theo khóa (FNV-1a) — cùng người luôn cùng màu. */
export function avatarColorIndex(key: string): number {
  let hash = 0x811c9dc5;
  for (const ch of key) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % AVATAR_COLORS.length;
}
