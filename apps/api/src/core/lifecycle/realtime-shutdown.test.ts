// Graceful shutdown có Socket.io (devops §7.3 bước 3–4): đóng socket của instance trước, rồi HTTP,
// rồi tài nguyên — tiến trình thoát 0 và không phải chờ hạn chót.
import { describe, expect, it } from 'vitest';

import { SpyLogger } from '../../../test/support';
import { connected, disconnected, startRealtime } from '../../../test/support/realtime';
import { createGracefulShutdown } from './graceful-shutdown';

describe('graceful shutdown với gateway realtime', () => {
  it('socket bị ngắt (client sẽ nối sang instance khác), HTTP đóng, tài nguyên đóng sau, exit 0', async () => {
    const rt = await startRealtime();
    const socket = rt.client();
    await connected(socket);

    const order: string[] = [];
    const exits: number[] = [];
    const shutdown = createGracefulShutdown({
      server: rt.server,
      logger: new SpyLogger(),
      drainMs: 0,
      timeoutMs: 3_000,
      realtime: [
        {
          name: 'socket.io',
          close: () => rt.gateway.close().then(() => void order.push('socket.io')),
        },
      ],
      resources: [{ name: 'valkey', close: () => void order.push('valkey') }],
      exit: (code) => void exits.push(code),
    });

    const gone = disconnected(socket);
    const startedAt = Date.now();
    await shutdown.shutdown('SIGTERM');
    expect(await gone).toBe('io server disconnect');
    expect(order).toEqual(['socket.io', 'valkey']);
    expect(exits).toEqual([0]);
    expect(rt.server.listening).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
