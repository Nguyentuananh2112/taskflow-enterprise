import { describe, expect, it } from 'vitest';

import { RateLimitedError } from '../errors';
import { ExportSlots, MAX_CONCURRENT_EXPORTS } from './export-slots';

// SEC-HR-54 (F): export thứ 3 đồng thời trong công ty ⇒ 429; nhả suất trong finally (kể cả client hủy).

describe('ExportSlots', () => {
  it('tối đa 2 đồng thời; thứ 3 ⇒ 429 RATE_LIMITED + Retry-After; nhả xong thì lấy lại được', () => {
    const slots = new ExportSlots();
    expect(MAX_CONCURRENT_EXPORTS).toBe(2);
    const a = slots.acquire();
    const b = slots.acquire();
    let err: unknown;
    try {
      slots.acquire();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).headers).toEqual({ 'Retry-After': '30' });
    a();
    a(); // nhả 2 lần vẫn chỉ nhả một suất
    expect(slots.running).toBe(1);
    const c = slots.acquire();
    expect(slots.running).toBe(2);
    b();
    c();
    expect(slots.running).toBe(0);
  });
});
