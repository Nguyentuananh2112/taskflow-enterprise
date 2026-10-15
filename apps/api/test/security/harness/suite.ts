import { afterAll, beforeAll, it } from 'vitest';

import { startApi, type RunningApi } from './api-process';
import { loadHarnessConfig, TEST_JWT_SECRET } from './config';
import { createEphemeralDatabase, type EphemeralDatabase } from './database';
import { rawRequest, type RawRequest, type RawResponse } from './http-client';

export interface ApiUnderTest {
  readonly baseUrl: string;
  readonly webOrigin: string;
  request(req: RawRequest): Promise<RawResponse>;
  logs(): readonly string[];
}

/** Env tối thiểu hợp lệ cho NODE_ENV=test; `overrides` để dựng biến thể (vd production). */
export function baseEnv(dbUrl: string, overrides: Record<string, string> = {}) {
  const config = loadHarnessConfig();
  return {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: dbUrl,
    REDIS_URL: config.redisUrl,
    JWT_ACCESS_SECRET: TEST_JWT_SECRET,
    CORS_ORIGINS: config.webOrigin,
    COOKIE_SECURE: 'false',
    TRUST_PROXY_HOPS: '0',
    GIT_SHA: 'security-suite',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}

/**
 * Mỗi file suite: một DB clone + một process API thật, dọn sau `afterAll`.
 * Trả về đối tượng lười — chỉ dùng bên trong test/hook.
 */
export function useApi(envOverrides: Record<string, string> = {}): ApiUnderTest {
  const config = loadHarnessConfig();
  let db: EphemeralDatabase | undefined;
  let api: RunningApi | undefined;

  beforeAll(async () => {
    db = await createEphemeralDatabase(config);
    api = await startApi(baseEnv(db.appUrl, envOverrides));
  }, 60_000);

  afterAll(async () => {
    await api?.stop();
    await db?.drop();
  }, 30_000);

  const running = (): RunningApi => {
    if (!api) throw new Error('API chưa khởi động (chỉ dùng useApi() trong test/hook)');
    return api;
  };

  return {
    get baseUrl() {
      return running().baseUrl;
    },
    webOrigin: config.webOrigin,
    request: (req) => rawRequest(running().baseUrl, req),
    logs: () => running().logs(),
  };
}

/**
 * Case SEC chưa chạy được vì route/tính năng chưa có. Tên luôn mang nhãn `PENDING-ROUTE` để báo
 * cáo đếm được; bị skip (KHÔNG xanh giả). Phase 3: đổi `pendingRoute` → `it` khi route merge.
 */
export function pendingRoute(id: string, title: string, blockedBy: string, fn?: () => unknown) {
  return it.skip(`[PENDING-ROUTE ${blockedBy}] ${id} — ${title}`, fn ?? (() => undefined));
}

/** Case thuộc tầng khác (Playwright/k6) — chỉ liệt kê để ma trận SEC đầy đủ. */
export function outOfScope(id: string, title: string, where: string) {
  return it.todo(`[${where}] ${id} — ${title}`);
}
