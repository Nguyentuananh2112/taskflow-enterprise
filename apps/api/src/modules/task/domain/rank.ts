import { ValidationError } from '../../../core/errors';

/**
 * Vị trí trong cột (ADR-011): chuỗi `fractional-indexing`, so sánh **theo byte** (khớp collation
 * "C" của DB) — không dùng `localeCompare`. Domain không sinh rank; application dùng `IRankGenerator`.
 */
export class Rank {
  private constructor(readonly value: string) {}

  static of(value: string): Rank {
    if (value.length === 0) {
      throw new ValidationError([
        { path: ['rank'], code: 'too_small', message: 'Rank không được rỗng.' },
      ]);
    }
    return new Rank(value);
  }
}
