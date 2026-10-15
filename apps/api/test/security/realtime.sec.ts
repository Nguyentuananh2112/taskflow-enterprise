import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { pendingRoute, useApi } from './harness/suite';

// Socket.io (ADR-027, ADR-074, security.md §5). Handshake websocket được thử bằng HTTP Upgrade thô
// (không cần socket.io-client): chỉ kiểm lớp `allowRequest` — Origin và transport — trước xác thực.
// Đối chứng: Origin hợp lệ phải nhận 101; nếu build chưa có gateway (main trước T-016) ⇒ PENDING.

const api = useApi();
const WS_PATH = '/socket.io/?EIO=4&transport=websocket';

interface UpgradeResult {
  status: number;
  body: string;
}

function tryUpgrade(
  path: string,
  headers: Record<string, string | undefined>,
): Promise<UpgradeResult> {
  const url = new URL(path, api.baseUrl);
  const all: Record<string, string> = {
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-version': '13',
    'sec-websocket-key': randomBytes(16).toString('base64'),
  };
  for (const [k, v] of Object.entries(headers)) if (v !== undefined) all[k] = v;

  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers: all, agent: false });
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      resolve({ status: 101, body: '' });
    });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString('utf8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    // Server từ chối có thể đóng socket thẳng (không có response) — vẫn là "bị từ chối".
    req.on('error', (err: NodeJS.ErrnoException) =>
      err.code === 'ECONNRESET' || err.code === 'EPIPE'
        ? resolve({ status: 0, body: err.code })
        : reject(err),
    );
    req.end();
  });
}

let gatewayLive = false;

beforeAll(async () => {
  const control = await tryUpgrade(WS_PATH, { origin: api.webOrigin });
  gatewayLive = control.status === 101;
});

describe('SEC-56 — handshake websocket kiểm Origin (chống CSWSH)', () => {
  beforeEach((ctx) => {
    if (!gatewayLive) ctx.skip('[PENDING-ROUTE T-016] build này chưa có gateway Socket.io');
  });

  it('đối chứng: Origin trong whitelist ⇒ 101 (để các case từ chối bên dưới có nghĩa)', async () => {
    expect((await tryUpgrade(WS_PATH, { origin: api.webOrigin })).status).toBe(101);
  });

  it.each([
    ['https://evil.example'],
    ['null'],
    [`${api.webOrigin}.evil.example`],
    [`${api.webOrigin}/`],
  ])('Origin %s ⇒ từ chối, không upgrade', async (origin) => {
    expect((await tryUpgrade(WS_PATH, { origin })).status).not.toBe(101);
  });

  it('thiếu Origin (token hợp lệ hay không) ⇒ từ chối', async () => {
    expect((await tryUpgrade(WS_PATH, { origin: undefined })).status).not.toBe(101);
  });

  it('transport polling (kể cả Origin hợp lệ) ⇒ không mở phiên engine.io', async () => {
    const res = await api.request({
      path: '/socket.io/?EIO=4&transport=polling',
      headers: { origin: api.webOrigin },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.text).not.toContain('"sid"');
  });

  it('không phục vụ file client (serveClient: false)', async () => {
    const res = await api.request({ path: '/socket.io/socket.io.js' });
    expect(res.status).not.toBe(200);
  });
});

describe('Xác thực & phòng (cần auth + workspace wiring Phase 3)', () => {
  const blocked = 'socket auth wiring (Phase 3)';
  pendingRoute(
    'SEC-35',
    'Handshake không token / token sai / tv cũ ⇒ connect_error data.code tương ứng',
    blocked,
  );
  pendingRoute(
    'SEC-36',
    'Bob project:join project của ws A ⇒ ack RESOURCE_NOT_FOUND, không nhận event',
    blocked,
  );
  pendingRoute(
    'SEC-37',
    'Mia bị xóa khỏi ws khi đang trong phòng ⇒ rời phòng + workspace:access-revoked',
    blocked,
  );
  pendingRoute(
    'SEC-37b',
    'CỔNG T-016 (TOCTOU): xóa Mia ĐÚNG LÚC project:join đang kiểm quyền (lặp 50 lần) ⇒ không lần nào Mia còn trong phòng',
    blocked,
  );
  pendingRoute('SEC-38', 'Không auth:renew quá exp ⇒ auth:expired rồi bị ngắt', blocked);
  pendingRoute('SEC-39', 'auth:renew bằng token của user khác ⇒ bị ngắt', blocked);
  pendingRoute(
    'SEC-41',
    'X-Client-Id của tab khác / không phải uuid ⇒ không ảnh hưởng quyền, bị bỏ qua',
    blocked,
  );
  pendingRoute('SEC-21b', 'Logout-all ⇒ socket của user bị ngắt', blocked);
});
