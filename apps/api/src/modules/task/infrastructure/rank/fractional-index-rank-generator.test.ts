import { describe, expect, it } from 'vitest';

import { FractionalIndexRankGenerator } from './fractional-index-rank-generator';

describe('FractionalIndexRankGenerator', () => {
  const ranks = new FractionalIndexRankGenerator();

  it('cột trống ⇒ "a0"; cuối cột tăng dần; giữa hai khóa nằm giữa theo byte', () => {
    expect(ranks.between(null, null)).toBe('a0');
    expect(ranks.between('a9', null)).toBe('aA');
    const mid = ranks.between('a0', 'a1');
    expect('a0' < mid && mid < 'a1').toBe(true);
    expect(ranks.between(null, 'a0') < 'a0').toBe(true);
  });

  it('khóa sai thứ tự / trùng nhau ⇒ ném (thư viện 4.0.0 tự trả "a0V" cho ("a1","a0"))', () => {
    expect(() => ranks.between('a1', 'a0')).toThrow(/phải đứng trước/);
    expect(() => ranks.between('a1', 'a1')).toThrow();
  });
});
