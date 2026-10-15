import { createClient } from 'redis';

import type { ILogger } from '../logging/logger';

/** Backoff reconnect: 100ms × 2^lần thử, trần 5s (không dồn dập khi Valkey sập lâu). */
export function valkeyReconnectDelay(retries: number): number {
  return Math.min(100 * 2 ** retries, 5_000);
}

const buildClient = (url: string) =>
  createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: valkeyReconnectDelay,
    },
  });

export type ValkeyClient = ReturnType<typeof buildClient>;

/**
 * Client node-redis tới Valkey (ADR-063). Không chặn khởi động khi Valkey chưa sẵn sàng:
 * gọi `connectInBackground()` — app vẫn chạy, `/readyz` báo `valkey: "degraded"` (ADR-074).
 * `disableOfflineQueue`: lệnh khi mất kết nối thất bại ngay (rate limit fail-open/closed rõ ràng),
 * không xếp hàng vô hạn.
 */
export function createValkeyClient(url: string, logger: ILogger): ValkeyClient {
  const client = buildClient(url);
  let lastErrorLoggedAt = 0;
  client.on('error', (err: unknown) => {
    // Khi Valkey sập, node-redis phát lỗi mỗi lần reconnect — chỉ log tối đa 1 lần / 30s.
    const now = Date.now();
    if (now - lastErrorLoggedAt < 30_000) return;
    lastErrorLoggedAt = now;
    logger.warn({ err }, 'valkey.error');
  });
  client.on('ready', () => logger.info('valkey.ready'));
  return client;
}

export function connectInBackground(client: ValkeyClient, logger: ILogger): void {
  client.connect().catch((err: unknown) => logger.warn({ err }, 'valkey.connect_failed'));
}
