import type { Store } from 'express-rate-limit';

import type { Env } from '../config/env';
import type { IClock } from '../core/domain';
import { valkeyByteCounter, type ValkeyIncrClient } from '../core/files/upload-byte-budget';
import { createRateLimit } from '../core/http/rate-limit/rate-limit';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../core/http/rate-limit/rules';
import type { ILogger } from '../core/logging/logger';
import type { AppMetrics } from '../core/observability/metrics';
import { createFiles, type FilesBundle } from './files-setup';

/**
 * Kho tệp của server thật (Mốc 6, ADR-141) — tách khỏi start-server.ts (max-lines). `FILE_STORE_DIR` không dùng được
 * ⇒ ném ⇒ từ chối khởi động; hạn mức IP `/media` + bộ đếm byte upload / ngày trên Valkey.
 */
export function serverFiles(d: {
  env: Env;
  clock: IClock;
  logger: ILogger;
  metrics: AppMetrics;
  storeFor: (rule: RateLimitRule) => Store;
  valkey: ValkeyIncrClient;
}): Promise<FilesBundle> {
  return createFiles({
    env: d.env,
    clock: d.clock,
    logger: d.logger,
    metrics: d.metrics,
    mediaRateLimit: createRateLimit(RATE_LIMIT_RULES.media[0], {
      storeFor: d.storeFor,
      logger: d.logger,
      userIdOf: () => undefined,
    }),
    webOrigin: d.env.CORS_ORIGINS[0] ?? 'http://localhost:3001',
    byteCounter: valkeyByteCounter(d.valkey),
  });
}
