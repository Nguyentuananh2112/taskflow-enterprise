import { describe, expect, it } from 'vitest';

import { SlidingWindow } from './sliding-window';

describe('SlidingWindow', () => {
  it('cho tới `limit` lần trong cửa sổ, theo từng key; qua cửa sổ thì được lại', () => {
    const w = new SlidingWindow({ windowMs: 1_000, limit: 2 });
    expect(w.tryHit('a', 0)).toBe(true);
    expect(w.tryHit('a', 500)).toBe(true);
    expect(w.tryHit('a', 999)).toBe(false);
    expect(w.tryHit('b', 999)).toBe(true);
    // Lần bị từ chối không được ghi: tại 1 000 lần đầu (0) đã ra khỏi cửa sổ ⇒ còn 1 suất.
    expect(w.tryHit('a', 1_000)).toBe(true);
    expect(w.tryHit('a', 1_001)).toBe(false);
    expect(w.tryHit('a', 1_501)).toBe(true);
  });

  it('dọn key không còn lần đếm trong cửa sổ (bộ nhớ không tăng mãi)', () => {
    const w = new SlidingWindow({ windowMs: 1_000, limit: 5 });
    w.tryHit('a', 0);
    w.tryHit('b', 600);
    expect(w.size).toBe(2);
    w.tryHit('c', 1_000); // dọn lần đầu: 'a' (0) đã hết hạn, 'b' (600) còn
    expect(w.size).toBe(2);
    w.tryHit('c', 1_500); // chưa tới lượt dọn (< windowMs từ lần trước)
    expect(w.size).toBe(2);
    w.tryHit('c', 2_000); // 'b' hết hạn
    expect(w.size).toBe(1);
  });

  it('limit 0 ⇒ luôn từ chối, không giữ key', () => {
    const w = new SlidingWindow({ windowMs: 1_000, limit: 0 });
    expect(w.tryHit('a', 0)).toBe(false);
    expect(w.size).toBe(0);
  });
});
