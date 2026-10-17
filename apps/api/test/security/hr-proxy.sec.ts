import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { Actors } from './harness/actors';
import { HR, eventsOf, hrClockEnv, todayVn } from './harness/hr';
import { secCase, useApi } from './harness/suite';

// SEC-HR-23 (test-spec-hr §7, T-042) — process API RIÊNG với TRUST_PROXY_HOPS=0 (suite chính chạy hops=1 để
// mỗi actor có IP giả riêng). Không tin proxy nào ⇒ `X-Forwarded-For` client gửi bị bỏ qua: IP lưu ở lượt chấm
// công là IP socket (loopback), không phải IP giả. Mọi request cùng một IP ⇒ chỉ đăng ký 2 user (Olivia là OWNER
// nên có hr:manage để đọc IP qua attendance/events) cho khỏi chạm limiter đăng ký.

const api = useApi({ TRUST_PROXY_HOPS: '0', ...hrClockEnv() });
const actors = new Actors(api);
const AREA = 'Mốc 3 HR — proxy';

/** IP socket của client test chạy cùng máy: IPv4 loopback (có thể dạng IPv4-mapped) hoặc IPv6 loopback. */
const LOOPBACK = /^(?:::ffff:)?127\.0\.0\.1$|^::1$/;
const FORGED = '203.0.113.7, 198.51.100.9';

describe('Proxy tin cậy = 0', () => {
  secCase(
    'SEC-HR-23',
    'X-Forwarded-For giả khi TRUST_PROXY_HOPS=0 ⇒ IP lưu là IP socket (process API riêng hops=0)',
    AREA,
    async () => {
      const olivia = await actors.register('hr-proxy-olivia');
      const mia = await actors.register('hr-proxy-mia');
      const ws = olivia.defaultWorkspaceId;
      await actors.addMember(olivia, ws, mia, 'MEMBER');

      const res = await api.request({
        method: 'POST',
        path: `/api/v1${HR.checkIn(ws)}`,
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

      const read = await actors.json(
        'GET',
        HR.eventsOf(ws, mia.userId, todayVn()),
        olivia.accessToken,
      );
      expect(read.status, read.text.slice(0, 200)).toBe(200);
      const events = eventsOf(read);
      expect(events).toHaveLength(1);
      const ip = events[0]?.ip ?? null;
      expect(ip, 'IP lưu phải là IP socket').toMatch(LOOPBACK);
      expect(FORGED).not.toContain(String(ip));
    },
  );
});
