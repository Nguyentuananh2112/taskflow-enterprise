import { randomUUID } from 'node:crypto';

import type { HireEmployeeResponse } from '@taskflow/contracts/company';
import { describe, expect } from 'vitest';

import { shiftIso, useCompanyApi } from './harness/company';
import { nextVnAnchor } from './harness/clock';
import { hrClockEnv } from './harness/hr';
import { errorEnvelope } from './harness/http-client';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// CLK-HR-06 (test-spec-company §5): link kích hoạt nhân viên sống ĐÚNG 7 ngày theo giờ NGHIỆP VỤ (ADR-137; `expires_at`
// ghi theo TEST_CLOCK_ANCHOR). Restart API với mốc tiến trên CÙNG DB (§1.3): 30 s trước hạn ⇒ inspect + activate 200;
// 30 s sau hạn ⇒ cả hai 410 ACTIVATION_GONE. Mốc lấy từ `expiresAt` THẬT của response (không ước thời gian chạy).
const ANCHOR = nextVnAnchor(2, '10:00:00');
const { api, actors } = useCompanyApi(hrClockEnv(ANCHOR));
const AREA = 'Mốc 3.5 kích hoạt — hạn link';
const PASSWORD = 'correct-horse-battery-staple-9';

async function hirePending(label: string) {
  await flushRateLimitCounters();
  const email = `${label}-${randomUUID()}@sec.example`;
  const res = await actors.hire(actors.ada, { email, fullName: `Sec ${label}` });
  expect(res.status, res.text.slice(0, 300)).toBe(201);
  const body = (res.json as { data: HireEmployeeResponse }).data;
  if (!body.activation) throw new Error('POST /hr/employees: email mới mà activation null');
  return { email, token: body.activation.token, expiresAt: body.activation.expiresAt };
}

const inspect = (token: string) =>
  actors.json('POST', '/auth/activation/inspect', undefined, { token });
const activate = (token: string) =>
  actors.json('POST', '/auth/activate', undefined, { token, password: PASSWORD });

describe('Hạn link kích hoạt 7 ngày (giờ nghiệp vụ)', () => {
  secCase(
    'CLK-HR-06',
    'restart mốc hạn − 30 s ⇒ inspect / activate 200; restart hạn + 30 s ⇒ 410 ACTIVATION_GONE',
    AREA,
    async () => {
      const early = await hirePending('clk06a');
      const late = await hirePending('clk06b');
      // Hạn = mốc lúc thêm + 7 ngày (giờ nghiệp vụ).
      const ttl = Date.parse(early.expiresAt) - Date.parse(ANCHOR);
      expect(ttl).toBeGreaterThanOrEqual(7 * 86_400_000);
      expect(ttl).toBeLessThan(7 * 86_400_000 + 10 * 60_000);

      await api.restart({ TEST_CLOCK_ANCHOR: shiftIso(early.expiresAt, -30_000) });
      await flushRateLimitCounters();
      const seen = await inspect(early.token);
      expect(seen.status, seen.text.slice(0, 200)).toBe(200);
      const ok = await activate(early.token);
      expect(ok.status, ok.text.slice(0, 200)).toBe(200);

      const lateExpiry = Math.max(Date.parse(early.expiresAt), Date.parse(late.expiresAt));
      await api.restart({
        TEST_CLOCK_ANCHOR: new Date(lateExpiry + 30_000).toISOString(),
      });
      await flushRateLimitCounters();
      for (const res of [await inspect(late.token), await activate(late.token)]) {
        expect(res.status, res.text.slice(0, 200)).toBe(410);
        expect(errorEnvelope(res).error).toMatchObject({ code: 'ACTIVATION_GONE' });
      }
      // Hết hạn ⇒ vẫn chờ kích hoạt: login mọi mật khẩu như không có user.
      const login = await actors.json('POST', '/auth/login', undefined, {
        email: late.email,
        password: PASSWORD,
      });
      expect(login.status).toBe(401);
    },
    300_000,
  );
});
