import { describe, expect, it } from 'vitest';

import { RateLimitedError, ServiceUnavailableError } from '../errors';
import { MemoryByteCounter, UploadByteBudget, valkeyByteCounter } from './upload-byte-budget';

describe('UploadByteBudget (ADR-141, SEC-CH-14)', () => {
  it('cộng dồn tới trần; vượt ⇒ 429 và TRẢ LẠI phần vừa cộng (lần nhỏ hơn sau đó vẫn qua)', async () => {
    let now = new Date('2026-10-18T10:00:00Z');
    const budget = new UploadByteBudget(new MemoryByteCounter(), 100, { now: () => now });
    await budget.consume('u', 60);
    await expect(budget.consume('u', 50)).rejects.toBeInstanceOf(RateLimitedError);
    await budget.consume('u', 40);
    await expect(budget.consume('u', 1)).rejects.toBeInstanceOf(RateLimitedError);
    await budget.consume('v', 100); // người khác độc lập
    now = new Date('2026-10-18T17:00:00Z'); // 00:00 giờ VN ngày 19 ⇒ ngày mới
    await budget.consume('u', 100);
  });

  it('retryAfter = tới nửa đêm giờ Việt Nam', async () => {
    const budget = new UploadByteBudget(new MemoryByteCounter(), 10, {
      now: () => new Date('2026-10-18T16:00:00Z'), // 23:00 VN
    });
    const err = await budget.consume('u', 11).catch((e: unknown) => e);
    expect((err as RateLimitedError).retryAfterSec).toBe(3600);
  });

  it('kho đếm lỗi ⇒ 503 (fail-closed)', async () => {
    const broken = { incrBy: () => Promise.reject(new Error('ECONNREFUSED')) };
    const budget = new UploadByteBudget(broken, 10, { now: () => new Date() });
    await expect(budget.consume('u', 1)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('Valkey: EXPIRE chỉ lần đầu trong ngày', async () => {
    const calls: string[] = [];
    let total = 0;
    const counter = valkeyByteCounter({
      incrBy: (_k, by) => Promise.resolve((total += by)),
      expire: (k, s) => Promise.resolve(void calls.push(`${k}:${s}`)),
    });
    await counter.incrBy('ub:u:d', 5, 99);
    await counter.incrBy('ub:u:d', 5, 99);
    expect(calls).toEqual(['ub:u:d:99']);
  });
});
