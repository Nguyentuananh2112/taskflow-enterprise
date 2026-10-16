// Tầng I (ADR-115): hạn mức realtime dùng chung giữa 2 instance trên Valkey THẬT — Lua chạy thật,
// mốc thời gian theo TIME của Valkey. Mỗi test dùng user id riêng ⇒ không phụ thuộc dữ liệu cũ.
import { randomUUID } from 'node:crypto';

import { createClient } from 'redis';
import { afterAll, describe, expect, it } from 'vitest';

import { FakeClock, integrationRequired, SpyLogger, testValkeyUrl } from '../../../test/support';
import { connected, startRealtime } from '../../../test/support/realtime';
import { MAX_SOCKETS_PER_USER, PROJECT_JOIN_LIMIT_PER_USER } from '../http/rate-limit/rules';
import { createValkeyClient } from '../infrastructure/valkey';
import { LocalRealtimeQuota } from './quota';
import { SharedRealtimeQuota } from './shared-quota';
import {
  HEARTBEAT_SCRIPT,
  INSTANCE_ALIVE_MS,
  INSTANCES_KEY,
  SOCKET_KEY,
} from './shared-quota.scripts';

const URL = testValkeyUrl();
const probe = createClient({
  url: URL,
  socket: { connectTimeout: 1_000, reconnectStrategy: false },
});
probe.on('error', () => undefined);
const available = await probe.connect().then(
  () => true,
  () => false,
);
if (!available && integrationRequired()) throw new Error(`Valkey không chạy ở ${URL}`);

describe.runIf(available)('SharedRealtimeQuota trên Valkey thật (2 instance)', () => {
  const valkey = createValkeyClient(URL, new SpyLogger());
  const quotas: SharedRealtimeQuota[] = [];
  const instance = (counts: () => ReadonlyMap<string, number> = () => new Map()) => {
    const q = new SharedRealtimeQuota({
      valkey,
      local: new LocalRealtimeQuota(new FakeClock(new Date())),
      instanceId: randomUUID(),
      logger: new SpyLogger(),
      heartbeatMs: 0,
    });
    q.start(counts);
    quotas.push(q);
    return q;
  };
  const user = () => `qa-${randomUUID()}`;
  afterAll(async () => {
    await Promise.all(quotas.map((q) => q.close()));
    if (valkey.isOpen) await valkey.close();
    await probe.close();
  });

  it('socket: 2 instance cộng dồn — chạm 20 thì CẢ HAI từ chối dù mỗi bên còn dưới trần cục bộ; trả suất ⇒ mở lại', async () => {
    await valkey.connect();
    const [a, b] = [instance(), instance()];
    await Promise.all([a.heartbeat(), b.heartbeat()]);
    const u = user();
    for (let i = 0; i < 12; i++) expect(await a.acquireSocket(u, i)).toBe(true);
    for (let i = 0; i < MAX_SOCKETS_PER_USER - 12; i++)
      expect(await b.acquireSocket(u, i)).toBe(true);
    expect(await a.acquireSocket(u, 12)).toBe(false);
    expect(await b.acquireSocket(u, 8)).toBe(false);
    await b.releaseSocket(u);
    expect(await a.acquireSocket(u, 12)).toBe(true);
  });

  it('instance chết (heartbeat cũ hơn 30 s theo giờ Valkey) ⇒ socket của nó không còn được tính, field bị dọn', async () => {
    const [a, b] = [instance(), instance()];
    await Promise.all([a.heartbeat(), b.heartbeat()]);
    const u = user();
    for (let i = 0; i < MAX_SOCKETS_PER_USER; i++) expect(await b.acquireSocket(u, 0)).toBe(true);
    expect(await a.acquireSocket(u, 0)).toBe(false);
    // Lùi heartbeat của B quá ngưỡng, theo TIME của Valkey (không phải đồng hồ máy test).
    const [sec] = await valkey.sendCommand<string[]>(['TIME']);
    const stale = Number(sec) * 1000 - INSTANCE_ALIVE_MS - 1_000;
    const bId = await valkey.sendCommand<string[]>(['HKEYS', SOCKET_KEY(u)]);
    await valkey.sendCommand(['ZADD', INSTANCES_KEY, String(stale), bId[0]!]);
    expect(await a.acquireSocket(u, 0)).toBe(true);
    expect(await valkey.sendCommand(['HLEN', SOCKET_KEY(u)])).toBe(1); // chỉ còn field của A
  });

  it('heartbeat ghi lại số socket THẬT: release bị mất (lệch +15) được sửa, user về 0 ⇒ xóa field', async () => {
    const u = user();
    let counts = new Map([[u, 2]]);
    const a = instance(() => counts);
    expect(await a.acquireSocket(u, 0)).toBe(true);
    const id = (await valkey.sendCommand<string[]>(['HKEYS', SOCKET_KEY(u)]))[0]!;
    await valkey.sendCommand(['HSET', SOCKET_KEY(u), id, '15']);
    await a.heartbeat();
    expect(await valkey.sendCommand(['HGET', SOCKET_KEY(u), id])).toBe('2');
    counts = new Map();
    await a.heartbeat();
    expect(await valkey.sendCommand(['HEXISTS', SOCKET_KEY(u), id])).toBe(0);
    expect(Number(await valkey.sendCommand(['PTTL', SOCKET_KEY(u)]))).toBeLessThan(0); // hash rỗng ⇒ mất
  });

  it('join theo user đếm CHUNG: 2 instance gộp lại đúng 60/phút', async () => {
    const [a, b] = [instance(), instance()];
    const u = user();
    const half = PROJECT_JOIN_LIMIT_PER_USER.limit / 2;
    for (let i = 0; i < half; i++) expect(await a.tryJoin(u)).toBe(true);
    for (let i = 0; i < half; i++) expect(await b.tryJoin(u)).toBe(true);
    expect(await a.tryJoin(u)).toBe(false);
    expect(await b.tryJoin(u)).toBe(false);
  });

  it('heartbeat 1000 user: 2 EVAL theo lô, đo thời gian (không thành tải định kỳ)', async () => {
    const counts = new Map(Array.from({ length: 1000 }, () => [user(), 1] as const));
    const a = instance(() => counts);
    const sent: string[][] = [];
    const send = valkey.sendCommand.bind(valkey);
    const spy = (args: string[]) => (sent.push(args), send(args));
    (valkey as unknown as { sendCommand: typeof spy }).sendCommand = spy;
    try {
      const t0 = performance.now();
      await a.heartbeat();
      const ms = performance.now() - t0;
      expect(sent.filter((c) => c[1] === HEARTBEAT_SCRIPT)).toHaveLength(2);
      expect(ms).toBeLessThan(1_000);
      console.info(`[rt-shared-limits] heartbeat 1000 user: ${ms.toFixed(1)} ms`);
    } finally {
      (valkey as unknown as { sendCommand: typeof send }).sendCommand = send;
    }
  });

  it('2 gateway thật cùng Valkey: socket thứ 21 của một user bị từ chối dù nối sang instance kia; ngắt một socket ⇒ nhận lại được', async () => {
    const shared = () =>
      new SharedRealtimeQuota({
        valkey,
        local: new LocalRealtimeQuota(new FakeClock(new Date())),
        instanceId: randomUUID(),
        logger: new SpyLogger(),
        heartbeatMs: 0,
      });
    const [qa, qb] = [shared(), shared()];
    const a = await startRealtime({ quota: qa });
    const b = await startRealtime({ quota: qb });
    try {
      await Promise.all([qa.heartbeat(), qb.heartbeat()]);
      const id = randomUUID();
      const token = `user:${id}:s1`;
      const sockets = [];
      for (let i = 0; i < MAX_SOCKETS_PER_USER; i++) {
        const socket = (i % 2 ? b : a).client({ token });
        await connected(socket);
        sockets.push(socket);
      }
      const extra = b.client({ token });
      const err = await new Promise<{ message: string }>((resolve) =>
        extra.once('connect_error', resolve),
      );
      expect(err.message).toBe('RATE_LIMITED');
      // Socket ở A ngắt ⇒ gateway A trả suất (Lua RELEASE) ⇒ B nhận được socket mới.
      sockets[0]!.disconnect();
      const total = async () =>
        (await valkey.sendCommand<string[]>(['HVALS', SOCKET_KEY(id)])).reduce(
          (sum, n) => sum + Number(n),
          0,
        );
      await expect.poll(total, { timeout: 3_000 }).toBe(MAX_SOCKETS_PER_USER - 1);
      await connected(b.client({ token }));
    } finally {
      await a.close();
      await b.close();
    }
  });
});
