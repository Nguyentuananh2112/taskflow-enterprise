import { generateKeyBetween } from 'fractional-indexing';

import { compareCodeUnits } from '@/shared/lib/rank';

/**
 * Rank TẠM cho optimistic update (frontend.md §4.3) — cùng thư viện với server, nhưng server vẫn tự
 * tính rank thật từ DB. Hàng xóm lệch (dữ liệu cũ) ⇒ `null`: bỏ optimistic vị trí.
 *
 * Lưu ý (kiểm trên fractional-indexing 4.0.0, T-025): `generateKeyBetween('a2', 'a1')` KHÔNG ném lỗi
 * mà trả `'a1V'` (nằm ngoài khoảng) ⇒ phải tự kiểm thứ tự; chỉ khóa sai định dạng mới ném.
 */
export function tempRankBetween(after: string | null, before: string | null): string | null {
  if (after !== null && before !== null && compareCodeUnits(after, before) >= 0) return null;
  try {
    return generateKeyBetween(after, before);
  } catch {
    return null;
  }
}
