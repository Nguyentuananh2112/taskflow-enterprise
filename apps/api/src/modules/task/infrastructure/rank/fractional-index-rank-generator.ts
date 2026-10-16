import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

import type { IRankGenerator } from '../../application/ports/collaborators.port';

/** `fractional-indexing` 4.0.0 (stack-versions §2, ADR-011): khóa base62, so sánh theo byte. */
export class FractionalIndexRankGenerator implements IRankGenerator {
  between(before: string | null, after: string | null): string {
    // 4.0.0 chỉ kiểm `a < b` khi hai khóa cùng phần nguyên: `between("a1", "a0")` trả "a0V"
    // (nằm NGOÀI khoảng) thay vì ném ⇒ tự chặn để dữ liệu lệch không sinh rank sai im lặng.
    if (before !== null && after !== null && !(before < after)) {
      throw new Error(`Rank không hợp lệ: "${before}" phải đứng trước "${after}"`);
    }
    return generateKeyBetween(before, after);
  }

  spread(n: number): string[] {
    // `generateNKeysBetween(null, null, 0)` đã trả `[]` (F3: nhánh n === 0 riêng là thừa).
    return generateNKeysBetween(null, null, n);
  }
}
