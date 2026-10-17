import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';

import type { Socket } from 'socket.io-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedTenants, type Actor } from './harness/actors';
import { useCompanyApi } from './harness/company';
import {
  collect,
  connected,
  connectError,
  disconnected,
  emitAck,
  nextEvent,
  openSocket,
} from './harness/socket';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// Socket.io (ADR-027, ADR-074, security.md §5). Handshake websocket được thử bằng HTTP Upgrade thô
// (không cần socket.io-client): chỉ kiểm lớp `allowRequest` — Origin và transport — trước xác thực.
// Đối chứng: Origin hợp lệ phải nhận 101; nếu build chưa có gateway (main trước T-016) ⇒ PENDING.

const { api, actors } = useCompanyApi();
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
    if (!gatewayLive) ctx.skip('[BUILD-PROBE T-016] build này chưa có gateway Socket.io');
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

// ---------- Xác thực & phòng (security.md §5, §8 SEC-35..41) — client Socket.io thật ----------
// Mỗi ca dựng tenant RIÊNG (xóa thành viên / logout-all làm bẩn dữ liệu). Mọi socket mở ra đều được
// đóng ở afterEach (kể cả khi ca đỏ) — tránh treo tiến trình test và chạm trần 20 socket/user.

const sockets: Socket[] = [];
const open = (token: string | undefined, clientId?: unknown) => {
  const socket = openSocket(api, token, clientId);
  sockets.push(socket);
  return socket;
};
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

const AUTH = 'socket auth';
const join = (socket: Socket, workspaceId: string, projectId: string) =>
  emitAck(socket, 'project:join', { workspaceId, projectId });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const UNAUTHORIZED = { message: 'UNAUTHORIZED', code: 'UNAUTHORIZED' };
const NOT_FOUND = { ok: false, code: 'RESOURCE_NOT_FOUND' };

/** Socket đã nối + đã vào phòng project — đối chứng rằng event thật sự được phát. */
async function joined(actor: Actor, wsId: string, projectId: string) {
  const socket = open(actor.accessToken);
  await connected(socket);
  expect(await join(socket, wsId, projectId)).toEqual({ ok: true });
  return socket;
}

describe('Xác thực & phòng', () => {
  secCase(
    'SEC-35',
    'Handshake không token / token sai / tv cũ ⇒ connect_error data.code tương ứng',
    AUTH,
    async () => {
      const t = await seedTenants(actors);
      expect(await connectError(open(undefined))).toEqual(UNAUTHORIZED);
      expect(await connectError(open('not-a-jwt'))).toEqual(UNAUTHORIZED);
      // Đối chứng: token còn hiệu lực nối được.
      await connected(open(t.mia.accessToken));
      // `tv` cũ: logout-all tăng token_version ⇒ access token cũ (chưa hết hạn) bị từ chối ở handshake.
      expect((await actors.json('POST', '/auth/logout-all', t.mia.accessToken)).status).toBe(204);
      expect(await connectError(open(t.mia.accessToken))).toEqual(UNAUTHORIZED);
    },
  );

  secCase(
    'SEC-36',
    'Bob project:join project của ws A ⇒ ack RESOURCE_NOT_FOUND, không nhận event',
    AUTH,
    async () => {
      const t = await seedTenants(actors);
      const bob = open(t.bob.accessToken);
      await connected(bob);
      // Đúng workspaceId của project (Bob không phải thành viên) và sai workspaceId (ws của chính Bob).
      expect(await join(bob, t.wsA, t.projectA.id)).toEqual(NOT_FOUND);
      expect(await join(bob, t.wsB, t.projectA.id)).toEqual(NOT_FOUND);
      const bobSaw = collect(bob, 'task:created');
      const mia = await joined(t.mia, t.wsA, t.projectA.id);
      const miaGot = nextEvent(mia, 'task:created');
      await actors.createTask(t.alice, t.wsA, t.projectA.id, 'bí mật của ws A');
      await miaGot; // đối chứng: event đã phát vào phòng
      await delay(300);
      expect(bobSaw()).toEqual([]);
    },
  );

  secCase(
    'SEC-37',
    'Mia bị xóa khỏi ws khi đang trong phòng ⇒ rời phòng + workspace:access-revoked',
    AUTH,
    async () => {
      const t = await seedTenants(actors);
      const mia = await joined(t.mia, t.wsA, t.projectA.id);
      const pam = await joined(t.pam, t.wsA, t.projectA.id);
      const revoked = nextEvent<{ data: unknown }>(mia, 'workspace:access-revoked');
      const removed = await actors.json(
        'DELETE',
        `/workspaces/${t.wsA}/members/${t.mia.userId}`,
        t.alice.accessToken,
      );
      expect(removed.status).toBe(200); // contract: 200 { userId, unassignedTaskCount }
      expect((await revoked).data).toEqual({ workspaceId: t.wsA });

      const miaSaw = collect(mia, 'task:created');
      const pamGot = nextEvent(pam, 'task:created');
      await actors.createTask(t.alice, t.wsA, t.projectA.id, 'sau khi Mia bị xóa');
      await pamGot;
      await delay(300);
      expect(miaSaw()).toEqual([]);
      // Join lại cũng không được.
      expect(await join(mia, t.wsA, t.projectA.id)).toEqual(NOT_FOUND);
    },
  );

  secCase(
    'SEC-37b',
    'CỔNG T-016 (TOCTOU): xóa Mia ĐÚNG LÚC project:join đang kiểm quyền (lặp 50 lần) ⇒ không lần nào Mia còn trong phòng',
    AUTH,
    async () => {
      const t = await seedTenants(actors);
      const pam = await joined(t.pam, t.wsA, t.projectA.id);
      const outcomes = { joined: 0, rejected: 0 };
      const removeMia = () =>
        actors.json('DELETE', `/workspaces/${t.wsA}/members/${t.mia.userId}`, t.alice.accessToken);
      for (let i = 0; i < 50; i += 1) {
        // 50 lần thêm lại thành viên vượt hạn mức member:add 30/giờ/user — hạn mức không phải đối tượng
        // của ca này ⇒ xóa bộ đếm mỗi vòng (db Valkey riêng của suite).
        await flushRateLimitCounters();
        if (i > 0) await actors.addMember(t.alice, t.wsA, t.mia, 'MEMBER');
        const mia = open(t.mia.accessToken);
        await connected(mia);
        // DELETE (HTTP, chậm hơn) đi trước, join trễ 0–24 ms ⇒ lần kiểm quyền của join rơi vào trước /
        // trong / sau lúc xóa commit. Đo thực tế: join đi trước thì 50/50 lần join xong trước khi xóa —
        // không chạm cửa sổ TOCTOU.
        const [removed, ack] = await Promise.all([
          removeMia(),
          delay(i % 25).then(() => join(mia, t.wsA, t.projectA.id)),
        ]);
        expect(removed.status).toBe(200);
        outcomes[ack.ok ? 'joined' : 'rejected'] += 1;

        const miaSaw = collect(mia, 'task:created');
        const pamGot = nextEvent(pam, 'task:created');
        await actors.createTask(t.alice, t.wsA, t.projectA.id, `vòng ${i}`);
        await pamGot;
        await delay(100);
        expect(miaSaw(), `vòng ${i} (join ${ack.ok ? 'thành công' : 'bị từ chối'})`).toEqual([]);
        mia.close();
      }
      // Phân bố để người đọc thấy cả hai thứ tự đều đã được thử.
      console.info(
        `[SEC-37b] 50 vòng — join thành công: ${outcomes.joined}, bị từ chối: ${outcomes.rejected}`,
      );
    },
    180_000,
  );

  secCase('SEC-39', 'auth:renew bằng token của user khác ⇒ bị ngắt', AUTH, async () => {
    const t = await seedTenants(actors);
    const mia = open(t.mia.accessToken);
    await connected(mia);
    const gone = disconnected(mia);
    // Server có thể ngắt trước khi ack tới ⇒ ack là tùy chọn, việc bị ngắt thì bắt buộc.
    const ack = await emitAck(mia, 'auth:renew', { token: t.alice.accessToken }).catch(() => null);
    if (ack) expect(ack).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(await gone).toBe('io server disconnect');
  });

  secCase(
    'SEC-41',
    'X-Client-Id của tab khác / không phải uuid ⇒ không ảnh hưởng quyền, bị bỏ qua',
    AUTH,
    async () => {
      const t = await seedTenants(actors);
      const miaTab = randomUUID();
      // clientId của handshake không phải uuid ⇒ bị bỏ qua, vẫn nối + join được.
      const bad = open(t.mia.accessToken, 'not-a-uuid');
      await connected(bad);
      expect(await join(bad, t.wsA, t.projectA.id)).toEqual({ ok: true });
      const mia = open(t.mia.accessToken, miaTab);
      await connected(mia);
      expect(await join(mia, t.wsA, t.projectA.id)).toEqual({ ok: true });

      const create = (actor: Actor, clientId: string) =>
        api.request({
          method: 'POST',
          path: `/api/v1/workspaces/${t.wsA}/projects/${t.projectA.id}/tasks`,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${actor.accessToken}`,
            origin: api.webOrigin,
            'x-client-id': clientId,
          },
          body: JSON.stringify({ title: `client-id ${clientId}` }),
        });
      type Envelope = { originClientId: string | null; actorId: string };

      // Alice gửi X-Client-Id của tab Mia: không đổi quyền/actor, event vẫn phát (chỉ là nhãn echo).
      let got = nextEvent<Envelope>(mia, 'task:created');
      expect((await create(t.alice, miaTab)).status).toBe(201);
      expect(await got).toMatchObject({ originClientId: miaTab, actorId: t.alice.userId });

      // Giá trị không phải uuid ⇒ bỏ qua (originClientId null), request vẫn thành công.
      got = nextEvent<Envelope>(mia, 'task:created');
      expect((await create(t.alice, 'not-a-uuid')).status).toBe(201);
      expect(await got).toMatchObject({ originClientId: null, actorId: t.alice.userId });

      // VIEWER mượn clientId của tab Mia vẫn không tạo được task.
      expect((await create(t.vic, miaTab)).status).toBe(403);
    },
  );

  secCase('SEC-21b', 'Logout-all ⇒ socket của user bị ngắt', AUTH, async () => {
    const t = await seedTenants(actors);
    const tabs = [open(t.mia.accessToken), open(t.mia.accessToken)];
    await Promise.all(tabs.map((s) => connected(s)));
    const pam = open(t.pam.accessToken);
    await connected(pam);
    const gone = tabs.map((s) => disconnected(s));
    expect((await actors.json('POST', '/auth/logout-all', t.mia.accessToken)).status).toBe(204);
    expect(await Promise.all(gone)).toEqual(['io server disconnect', 'io server disconnect']);
    // User khác không bị ảnh hưởng.
    expect(pam.connected).toBe(true);
  });
});
