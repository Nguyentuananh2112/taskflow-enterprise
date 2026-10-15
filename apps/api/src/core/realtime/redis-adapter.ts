import { createAdapter } from '@socket.io/redis-adapter';

import type { ValkeyClient } from '../infrastructure/valkey';
import type { ILogger } from '../logging/logger';

export interface ValkeyAdapter {
  adapter: ReturnType<typeof createAdapter>;
  /** Đóng 2 kết nối pub/sub — gọi trong graceful shutdown sau khi đóng gateway. */
  close(): Promise<void>;
}

/**
 * `@socket.io/redis-adapter` trên Valkey (ADR-027, devops §7.2) — chỉ bật khi
 * `SOCKET_REDIS_ADAPTER=true` (≥ 2 instance). Cần 2 kết nối riêng cho pub/sub.
 */
export async function createValkeyAdapter(
  base: ValkeyClient,
  logger: ILogger,
): Promise<ValkeyAdapter> {
  const pub = base.duplicate();
  const sub = base.duplicate();
  for (const client of [pub, sub]) {
    client.on('error', (err: unknown) => logger.warn({ err }, 'realtime.adapter_valkey_error'));
  }
  await Promise.all([pub.connect(), sub.connect()]);
  return {
    adapter: createAdapter(pub, sub),
    close: async () => {
      await Promise.allSettled([pub.close(), sub.close()]);
    },
  };
}
