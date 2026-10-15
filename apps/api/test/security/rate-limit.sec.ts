import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { errorEnvelope, type RawResponse } from './harness/http-client';
import { pendingRoute, useApi } from './harness/suite';
import { flushRateLimitCounters as flushCounters } from './harness/valkey';

// Rate limit toàn cục (security.md §6.4). Suite tự phát hiện limiter: chưa có (main trước T-016)
// ⇒ skip có nhãn PENDING-ROUTE; có ⇒ chạy thật. Bộ đếm nằm ở Valkey db 15 riêng, xóa trước mỗi test.

const api = useApi();
const PROBE = '/api/v1/__sec-probe';
const ANON_LIMIT = 100;
/**
 * Trần cho request mang Authorization (T-016 rev2: 1000/phút/IP). Gửi vượt trần một khoảng an toàn;
 * tới đó vẫn chưa 429 ⇒ bypass. Trần đổi ⇒ sửa ở đây (security.md §6.4 là nguồn).
 */
const AUTH_HEADER_CEILING = 1_000;
const AUTH_PROBE_MAX = AUTH_HEADER_CEILING + 50;

let limiterLive = false;

/** Gửi tối đa `max` request (theo lô song song nhỏ); trả về số thứ tự request 429 đầu tiên. */
async function firstRateLimited(max: number, headers: () => Record<string, string>) {
  let sent = 0;
  while (sent < max) {
    const batch = Math.min(20, max - sent);
    const responses = await Promise.all(
      Array.from({ length: batch }, () => api.request({ path: PROBE, headers: headers() })),
    );
    const hit = responses.findIndex((r) => r.status === 429);
    if (hit >= 0) return { index: sent + hit + 1, response: responses[hit] as RawResponse };
    sent += batch;
  }
  return undefined;
}

beforeAll(async () => {
  await flushCounters();
  const res = await api.request({ path: PROBE });
  limiterLive =
    res.headers['ratelimit-policy'] !== undefined || res.headers.ratelimit !== undefined;
});

beforeEach(async (ctx) => {
  if (!limiterLive) ctx.skip('[PENDING-ROUTE T-016] chưa có rate limit toàn cục trên build này');
  await flushCounters();
});

describe('Rate limit toàn cục — request chưa xác thực', () => {
  it(`đối chứng: request ẩn danh thứ ${ANON_LIMIT + 1} ⇒ 429 RATE_LIMITED + Retry-After`, async () => {
    const hit = await firstRateLimited(ANON_LIMIT + 5, () => ({}));
    expect(hit?.index).toBe(ANON_LIMIT + 1);
    expect(errorEnvelope(hit!.response).error.code).toBe('RATE_LIMITED');
    expect(Number(hit!.response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('X-Forwarded-For giả (TRUST_PROXY_HOPS=0) không tạo bucket mới', async () => {
    let n = 0;
    const hit = await firstRateLimited(ANON_LIMIT + 5, () => ({
      'x-forwarded-for': `203.0.113.${(n++ % 250) + 1}`,
    }));
    expect(hit?.index).toBe(ANON_LIMIT + 1);
  });

  it('CỔNG T-016 (bypass): Authorization rác KHÔNG được thoát giới hạn theo IP', async () => {
    const hit = await firstRateLimited(AUTH_PROBE_MAX, () => ({
      authorization: 'Bearer not-a-real-token',
    }));
    // Bản T-016 9f79853: bỏ qua limiter khi có header ⇒ không bao giờ 429 ⇒ test đỏ.
    expect(hit, `${AUTH_PROBE_MAX} request với token rác không bị chặn`).toBeDefined();
  }, 60_000);

  it('Authorization không phải Bearer cũng không thoát giới hạn', async () => {
    const hit = await firstRateLimited(AUTH_PROBE_MAX, () => ({
      authorization: 'Basic Og==',
    }));
    expect(hit).toBeDefined();
  }, 60_000);
});

describe('Rate limit theo endpoint', () => {
  pendingRoute(
    'GATE-T016-401',
    'Token rác trên route CẦN xác thực: bucket 401 (30/phút/IP) ⇒ request thứ 31 bị 429',
    'route đã xác thực (T-021)',
  );
  pendingRoute(
    'SEC-28',
    '6 lần login sai cùng IP+email trong 15 phút ⇒ lần 6: 429 + Retry-After',
    'auth routes (Phase 3)',
  );
  pendingRoute(
    'SEC-28b',
    'Valkey tắt ⇒ login/register 503 (fail-closed), API thường vẫn chạy',
    'auth routes (Phase 3)',
  );
});
