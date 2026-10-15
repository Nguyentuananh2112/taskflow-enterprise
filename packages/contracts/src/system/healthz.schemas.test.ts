import { describe, expect, it } from 'vitest';

import { DateOnly, HealthzResponse, Uuid } from '../index';

describe('contracts pipeline', () => {
  it('HealthzResponse chấp nhận payload hợp lệ và từ chối field lạ', () => {
    expect(HealthzResponse.parse({ status: 'ok', gitSha: 'dev' })).toEqual({
      status: 'ok',
      gitSha: 'dev',
    });
    expect(HealthzResponse.safeParse({ status: 'ok', gitSha: 'dev', extra: 1 }).success).toBe(
      false,
    );
    expect(HealthzResponse.safeParse({ status: 'down', gitSha: 'dev' }).success).toBe(false);
  });

  it('primitives dùng cú pháp Zod 4 đã chốt ở T-001', () => {
    expect(Uuid.safeParse('0199e5a2-7c1e-7cc3-9a3b-1f2e3d4c5b6a').success).toBe(true);
    expect(Uuid.safeParse('not-a-uuid').success).toBe(false);
    expect(DateOnly.safeParse('2026-10-15').success).toBe(true);
    expect(DateOnly.safeParse('2026-10-15T00:00:00Z').success).toBe(false);
  });
});
