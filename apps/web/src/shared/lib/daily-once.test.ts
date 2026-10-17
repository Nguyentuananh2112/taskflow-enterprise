import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDailyOnce, suppressDailyOnceForTest } from './daily-once';
import { localKeys, readLocal } from './storage';

beforeEach(() => {
  suppressDailyOnceForTest(false);
  for (const ns of ['t1', 't2', 't3', 't4', 't5']) createDailyOnce(ns).forgetAll();
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
    // Một khóa cho mỗi phạm vi (đã băm — không lộ định danh thô), giá trị là ngày cuối.
    const keys = localKeys('t2:');
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('u1');
    expect(readLocal(keys[0] ?? '')).toBe('2026-10-16');
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

  it('forgetAll (đăng xuất) ⇒ xóa mọi khóa của namespace, không đụng khóa khác; lần sau lại "chưa"', () => {
    const once = createDailyOnce('t4');
    once.mark('u1:w1', '2026-10-15');
    once.mark('u2:w1', '2026-10-15');
    createDailyOnce('t5').mark('u1:w1', '2026-10-15');
    once.forgetAll();
    expect(localKeys('t4:')).toEqual([]);
    expect(localKeys('t5:')).toHaveLength(1);
    expect(createDailyOnce('t4').seen('u1:w1', '2026-10-15')).toBe(false);
  });
});
