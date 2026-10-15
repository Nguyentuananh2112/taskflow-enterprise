import { createAdapter } from '@socket.io/redis-adapter';

import type { ValkeyClient } from '../infrastructure/valkey';
import type { ILogger } from '../logging/logger';

export interface ValkeyAdapter {
  adapter: ReturnType<typeof createAdapter>;
  /** Đóng 2 kết nối pub/sub — gọi trong graceful shutdown sau khi đóng gateway. */
  close(): Promise<void>;
}

/** Chỉ log tối đa 1 lần / 30s — khi Valkey sập, lỗi lặp lại ở mỗi lần publish/reconnect. */
const LOG_EVERY_MS = 30_000;

/**
 * `@socket.io/redis-adapter` 8.3 gọi `pubClient.publish(...)` KHÔNG await/catch (broadcast,
 * delSockets, disconnectSockets…). Client có `disableOfflineQueue` ⇒ khi Valkey chập chờn, publish
 * reject ngay ⇒ unhandledRejection ⇒ graceful shutdown thoát process (T-028 H3). Bọc `publish`:
 * lỗi chỉ được log, trả 0 subscriber. Mọi thuộc tính khác chuyển thẳng tới client gốc.
 */
export function guardPublisher<T extends { publish(...args: never[]): unknown }>(
  client: T,
  logger: ILogger,
): T {
  let lastLoggedAt = Number.NEGATIVE_INFINITY;
  const onError = (err: unknown): number => {
    const now = Date.now();
    if (now - lastLoggedAt >= LOG_EVERY_MS) {
      lastLoggedAt = now;
      logger.warn({ err }, 'realtime.adapter_publish_failed');
    }
    return 0;
  };
  const publish = (...args: Parameters<T['publish']>): Promise<unknown> => {
    try {
      return Promise.resolve(client.publish(...args)).catch(onError);
    } catch (err) {
      return Promise.resolve(onError(err));
    }
  };
  return new Proxy(client, {
    get: (target, prop) => {
      if (prop === 'publish') return publish;
      const value: unknown = Reflect.get(target, prop, target);
      // Gọi method trên client gốc (node-redis dùng trường #private — `this` là Proxy sẽ lỗi).
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * `@socket.io/redis-adapter` trên Valkey (ADR-027, devops §7.2) — chỉ bật khi
 * `SOCKET_REDIS_ADAPTER=true` (≥ 2 instance). Cần 2 kết nối riêng cho pub/sub.
 * `key`: tiền tố kênh pub/sub (mặc định của thư viện là `socket.io`) — test dùng key riêng để
 * không nhận nhầm message của người khác trên Valkey dùng chung (pub/sub không theo DB index).
 */
export async function createValkeyAdapter(
  base: ValkeyClient,
  logger: ILogger,
  options: { key?: string } = {},
): Promise<ValkeyAdapter> {
  const pub = base.duplicate();
  const sub = base.duplicate();
  for (const client of [pub, sub]) {
    client.on('error', (err: unknown) => logger.warn({ err }, 'realtime.adapter_valkey_error'));
  }
  await Promise.all([pub.connect(), sub.connect()]);
  return {
    adapter: createAdapter(guardPublisher(pub, logger), sub, options),
    close: async () => {
      await Promise.allSettled([pub.close(), sub.close()]);
    },
  };
}
