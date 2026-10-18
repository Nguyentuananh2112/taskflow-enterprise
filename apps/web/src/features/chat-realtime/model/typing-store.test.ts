import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TYPING_TTL_MS, typingStore } from './typing-store';

describe('typingStore (ADR-145 — đang gõ ≤ 5 s)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    typingStore.reset();
    vi.useRealTimers();
  });

  it('hiện sau event, tự tắt sau TTL; event mới gia hạn', () => {
    const seen: Array<readonly string[]> = [];
    const off = typingStore.subscribe(() => seen.push(typingStore.get('c1')));
    typingStore.start('c1', 'vic');
    expect(typingStore.get('c1')).toEqual(['vic']);
    vi.advanceTimersByTime(TYPING_TTL_MS - 1_000);
    typingStore.start('c1', 'vic'); // gõ tiếp ⇒ gia hạn
    vi.advanceTimersByTime(TYPING_TTL_MS - 1);
    expect(typingStore.get('c1')).toEqual(['vic']);
    vi.advanceTimersByTime(1);
    expect(typingStore.get('c1')).toEqual([]);
    expect(seen.at(-1)).toEqual([]);
    off();
  });

  it('tin của người đó đến ⇒ tắt ngay; hội thoại khác không ảnh hưởng; snapshot ổn định khi không đổi', () => {
    typingStore.start('c1', 'vic');
    typingStore.start('c2', 'mia');
    const before = typingStore.get('c2');
    typingStore.stop('c1', 'vic');
    expect(typingStore.get('c1')).toEqual([]);
    expect(typingStore.get('c2')).toBe(before);
  });
});
