import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDailyOnce, suppressDailyOnceForTest } from './daily-once';
import { readLocal, removeLocal } from './storage';

beforeEach(() => {
  suppressDailyOnceForTest(false);
  for (const key of ['t1:u1:w1', 't1:u1:w2', 't2:u1:w1', 't3:u1:w1']) removeLocal(key);
});
afterEach(() => {
  vi.restoreAllMocks();
  suppressDailyOnceForTest(true);
});

describe('createDailyOnce', () => {
  it('mark ⇒ seen trong NGÀY đó, theo đúng phạm vi; ngày mới ⇒ chưa', () => {
    const once = createDailyOnce('t1');
    expect(once.seen('u1:w1', '2026-10-15')).toBe(false);
    once.mark('u1:w1', '2026-10-15');
    expect(once.seen('u1:w1', '2026-10-15')).toBe(true);
    expect(once.seen('u1:w2', '2026-10-15')).toBe(false);
    expect(once.seen('u1:w1', '2026-10-16')).toBe(false);
  });

  it('localStorage giữ qua "tải lại trang" (instance mới); chỉ lưu ngày cuối ⇒ không phình', () => {
    createDailyOnce('t2').mark('u1:w1', '2026-10-15');
    expect(createDailyOnce('t2').seen('u1:w1', '2026-10-15')).toBe(true);
    createDailyOnce('t2').mark('u1:w1', '2026-10-16');
    // Một khóa cho mỗi phạm vi, giá trị là ngày cuối.
    expect(readLocal('t2:u1:w1')).toBe('2026-10-16');
  });

  it('storage lỗi (đọc + ghi ném) ⇒ vẫn tối đa 1 lần trong phiên nhờ bộ nhớ', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const once = createDailyOnce('t3');
    expect(once.seen('u1:w1', '2026-10-15')).toBe(false);
    once.mark('u1:w1', '2026-10-15');
    expect(once.seen('u1:w1', '2026-10-15')).toBe(true);
  });
});
