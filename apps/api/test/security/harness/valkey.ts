import { createClient } from 'redis';

import { loadHarnessConfig } from './config';

/**
 * Xóa toàn bộ key trong Valkey db RIÊNG của suite (mặc định db 15 — `SEC_REDIS_URL`). Chỉ dùng cho
 * bộ đếm rate limit / cache phiên của process API dưới test; không bao giờ chạm db 0 của server dev.
 */
export async function flushRateLimitCounters(): Promise<void> {
  const url = loadHarnessConfig().redisUrl;
  if (!/\/(?:[1-9]|1[0-5])$/.test(url)) {
    throw new Error(`Từ chối FLUSHDB trên ${url}: suite chỉ được dùng db 1–15 riêng`);
  }
  const client = createClient({ url });
  await client.connect();
  try {
    await client.flushDb();
  } finally {
    await client.close();
  }
}
