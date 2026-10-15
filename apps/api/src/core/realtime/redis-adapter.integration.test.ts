// Tầng I: 2 instance API dùng chung Valkey qua @socket.io/redis-adapter (devops §7.2, ADR-027).
import { createClient } from 'redis';
import { afterAll, describe, expect, it } from 'vitest';

import { SpyLogger } from '../../../test/support';
import {
  connected,
  disconnected,
  emitWithAck,
  nextEvent,
  startRealtime,
} from '../../../test/support/realtime';
import { createValkeyClient } from '../infrastructure/valkey';
import { createValkeyAdapter, type ValkeyAdapter } from './redis-adapter';

const URL = process.env['TEST_VALKEY_URL'] ?? 'redis://127.0.0.1:6380';
const probe = createClient({
  url: URL,
  socket: { connectTimeout: 1_000, reconnectStrategy: false },
});
probe.on('error', () => undefined);
const available = await probe.connect().then(
  () => true,
  () => false,
);
if (!available && process.env['REQUIRE_INTEGRATION'] === '1')
  throw new Error(`Valkey không chạy ở ${URL}`);

const WS = '0199e5a2-7c1e-7cc3-9a3b-000000000001';
const P1 = '0199e5a2-7c1e-7cc3-9a3b-0000000000a1';

describe.runIf(available)('redis adapter trên Valkey thật (2 instance)', () => {
  const base = createValkeyClient(URL, new SpyLogger());
  const adapters: ValkeyAdapter[] = [];
  afterAll(async () => {
    await Promise.all(adapters.map((a) => a.close()));
    if (base.isOpen) await base.close();
    await probe.close();
  });

  it('phát ở instance A tới phòng project ⇒ client nối vào instance B nhận được; thu hồi từ A ngắt socket ở B', async () => {
    await base.connect();
    const [adapterA, adapterB] = await Promise.all([
      createValkeyAdapter(base, new SpyLogger()),
      createValkeyAdapter(base, new SpyLogger()),
    ]);
    adapters.push(adapterA, adapterB);
    const a = await startRealtime({ adapter: adapterA.adapter });
    const b = await startRealtime({ adapter: adapterB.adapter });
    try {
      b.accessChecker.allow('u1', WS, P1);
      const socket = b.client({ token: 'user:u1:s1' });
      await connected(socket);
      expect(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual(
        { ok: true },
      );

      const received = nextEvent<{ data: unknown }>(socket, 'task:created', 3_000);
      await a.gateway.emitToProject(
        { projectId: P1, type: 'task:created', data: { task: { id: 't1' } } },
        { actorId: 'u2' },
      );
      expect((await received).data).toEqual({ task: { id: 't1' } });

      const gone = disconnected(socket);
      await a.gateway.disconnectUser('u1');
      expect(await gone).toBe('io server disconnect');
    } finally {
      await a.close();
      await b.close();
    }
  });
});
