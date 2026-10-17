import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { HR, eventsOf, hrClockEnv, todayVn } from './harness/hr';
import { secCase } from './harness/suite';

// SEC-HR-23 (test-spec-hr §7, T-042; test-spec-company §6.1 P) — process API RIÊNG với TRUST_PROXY_HOPS=0 (suite
// chính chạy hops=1 để mỗi actor có IP giả riêng). Không tin proxy nào ⇒ `X-Forwarded-For` client gửi bị bỏ qua: IP
// lưu ở lượt chấm công là IP socket (loopback), không phải IP giả. Mọi request cùng một IP ⇒ chỉ tạo 2 người (Hana có
// HR_MANAGE để đọc IP qua attendance/events).

const { api, actors } = useCompanyApi({ TRUST_PROXY_HOPS: '0', ...hrClockEnv() });
const AREA = 'Mốc 3.5 HR — proxy';

/** IP socket của client test chạy cùng máy: IPv4 loopback (có thể dạng IPv4-mapped) hoặc IPv6 loopback. */
const LOOPBACK = /^(?:::ffff:)?127\.0\.0\.1$|^::1$/;
const FORGED = '203.0.113.7, 198.51.100.9';

describe('Proxy tin cậy = 0', () => {
  secCase(
    'SEC-HR-23',
    'X-Forwarded-For giả khi TRUST_PROXY_HOPS=0 ⇒ IP lưu là IP socket (process API riêng hops=0)',
    AREA,
    async () => {
      const hana = await actors.createUser('hr-proxy-hana', { grants: ['HR_MANAGE'] });
      const mia = await actors.createUser('hr-proxy-mia');

      const res = await api.request({
        method: 'POST',
        path: `/api/v1${HR.checkIn}`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${mia.accessToken}`,
          origin: api.webOrigin,
          'idempotency-key': randomUUID(),
          'x-forwarded-for': FORGED,
        },
        body: '{}',
      });
      expect(res.status, res.text.slice(0, 200)).toBe(201);

      const read = await actors.json('GET', HR.eventsOf(mia.userId, todayVn()), hana.accessToken);
      expect(read.status, read.text.slice(0, 200)).toBe(200);
      const events = eventsOf(read);
      expect(events).toHaveLength(1);
      const ip = events[0]?.ip ?? null;
      expect(ip, 'IP lưu phải là IP socket').toMatch(LOOPBACK);
      expect(FORGED).not.toContain(String(ip));
    },
  );
});
