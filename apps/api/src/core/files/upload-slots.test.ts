import { describe, expect, it } from 'vitest';

import { MAX_CONCURRENT_UPLOADS, MAX_CONCURRENT_UPLOADS_TOTAL, UploadSlots } from './upload-slots';

describe('UploadSlots', () => {
  it(`≤ ${MAX_CONCURRENT_UPLOADS} lượt mỗi người; nhả ⇒ lấy lại được; nhả hai lần không đếm âm`, () => {
    const slots = new UploadSlots();
    const held = Array.from({ length: MAX_CONCURRENT_UPLOADS }, () => slots.tryAcquire('a'));
    expect(held.every(Boolean)).toBe(true);
    expect(slots.tryAcquire('a')).toBeNull();
    expect(slots.tryAcquire('b')).not.toBeNull(); // người khác không bị ảnh hưởng
    held[0]?.();
    held[0]?.();
    expect(slots.inFlight('a')).toBe(MAX_CONCURRENT_UPLOADS - 1);
    expect(slots.tryAcquire('a')).not.toBeNull();
  });

  it(`trần chung ${MAX_CONCURRENT_UPLOADS_TOTAL} lượt / tiến trình (B L3)`, () => {
    const slots = new UploadSlots();
    const held = Array.from({ length: MAX_CONCURRENT_UPLOADS_TOTAL }, (_, i) =>
      slots.tryAcquire(`u${i}`),
    );
    expect(held.every(Boolean)).toBe(true);
    expect(slots.total).toBe(MAX_CONCURRENT_UPLOADS_TOTAL);
    expect(slots.tryAcquire('new-user')).toBeNull();
    held[5]?.();
    expect(slots.tryAcquire('new-user')).not.toBeNull();
  });

  it('nhả hết ⇒ không còn khóa người dùng trong bộ nhớ', () => {
    const slots = new UploadSlots(3, 12);
    const release = slots.tryAcquire('a');
    release?.();
    expect([slots.inFlight('a'), slots.total]).toEqual([0, 0]);
  });
});
