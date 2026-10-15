// Tầng I (T-030, T-028 H3): adapter bật, Valkey "sập" giữa chừng ⇒ process không thoát, thu hồi
// vẫn áp dụng ở instance hiện tại. KHÔNG dừng Valkey dùng chung: test đi qua một proxy TCP riêng và
// cắt proxy (chỉ kết nối của test này mất), kênh pub/sub dùng key riêng.
import { randomUUID } from 'node:crypto';
import net, { type AddressInfo } from 'node:net';

import { createClient } from 'redis';
import { afterAll, describe, expect, it } from 'vitest';

import { integrationRequired, SpyLogger, testValkeyUrl } from '../../../test/support';
import {
  connected,
  disconnected,
  emitWithAck,
  startRealtime,
} from '../../../test/support/realtime';
import { createValkeyClient } from '../infrastructure/valkey';
import { createValkeyAdapter } from './redis-adapter';

const URL_ = testValkeyUrl();
const probe = createClient({
  url: URL_,
  socket: { connectTimeout: 1_000, reconnectStrategy: false },
});
probe.on('error', () => undefined);
const available = await probe.connect().then(
  () => true,
  () => false,
);
if (!available && integrationRequired()) throw new Error(`Valkey không chạy ở ${URL_}`);

const WS = '0199e5a2-7c1e-7cc3-9a3b-000000000001';
const P1 = '0199e5a2-7c1e-7cc3-9a3b-0000000000a1';

/** Proxy TCP tới Valkey thật; `cut()` đóng proxy và mọi kết nối đang mở (mô phỏng Valkey sập). */
async function startProxy(target: URL) {
  const open = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(target.port || 6379), target.hostname);
    for (const s of [client, upstream]) {
      open.add(s);
      s.on('error', () => undefined);
      s.on('close', () => open.delete(s));
    }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(target);
  url.hostname = '127.0.0.1';
  url.port = String((server.address() as AddressInfo).port);
  return {
    url: url.toString(),
    cut: async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      open.forEach((s) => s.destroy());
      await closed;
    },
  };
}

const until = async (check: () => boolean, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe.runIf(available)('redis adapter khi Valkey sập (T-028 H3)', () => {
  afterAll(async () => {
    await probe.close();
  });

  it('publish lỗi ⇒ không unhandledRejection; xóa thành viên / logout-all vẫn đẩy socket local ra', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    const proxy = await startProxy(new URL(URL_));
    const logger = new SpyLogger();
    const base = createValkeyClient(proxy.url, logger);
    await base.connect();
    const adapter = await createValkeyAdapter(base, logger, { key: `t030-${randomUUID()}` });
    const rt = await startRealtime({ adapter: adapter.adapter, logger });
    try {
      rt.accessChecker.allow('u2', WS, P1);
      const member = rt.client({ token: 'user:u2:s2' });
      const user = rt.client({ token: 'user:u1:s1' });
      await Promise.all([connected(member), connected(user)]);
      expect(await emitWithAck(member, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual(
        { ok: true },
      );

      await proxy.cut();
      // Chờ tới khi CHÍNH kết nối pub đã biết Valkey mất (publish thất bại) — lỗi của kết nối sub
      // có thể tới trước, khi đó publish còn ghi vào socket đã hủy và chỉ lỗi về sau (dễ chập chờn
      // khi máy bận). Phát thử tới khi guard log `adapter_publish_failed`.
      await until(() => {
        void rt.gateway.emitToProject(
          { projectId: P1, type: 'task:updated', data: {} },
          { actorId: 'probe' },
        );
        return logger.messages('warn').includes('realtime.adapter_publish_failed');
      });

      // Xóa thành viên (SEC-37) — afterCommit gọi revokeWorkspaceAccess.
      await rt.gateway.revokeWorkspaceAccess(
        { userId: 'u2', workspaceId: WS, projectIds: [P1] },
        { actorId: 'owner' },
      );
      const [server] = (await rt.gateway.io.local.fetchSockets()).filter(
        (s) => s.data.userId === 'u2',
      );
      expect(server?.rooms.has('project:' + P1)).toBe(false);

      // logout-all ⇒ disconnectUser.
      const gone = disconnected(user);
      await rt.gateway.disconnectUser('u1');
      expect(await gone).toBe('io server disconnect');

      // Phát event lúc Valkey sập: chỉ log, không làm sập process.
      await rt.gateway.emitToProject(
        { projectId: P1, type: 'task:created', data: {} },
        { actorId: 'owner' },
      );
      // Rejection (nếu có) của các publish trên xảy ra trong vài tick — chờ rộng tay khi máy bận.
      await new Promise((r) => setTimeout(r, 300));
      expect(unhandled).toEqual([]);
      expect(member.connected).toBe(true);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await rt.close();
      await adapter.close();
      base.destroy();
    }
  });
});
