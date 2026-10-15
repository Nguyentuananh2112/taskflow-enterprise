import { afterAll, beforeAll, beforeEach, it } from 'vitest';

import { API_DIR, startApi, type RunningApi } from './api-process';
import { loadHarnessConfig, TEST_JWT_SECRET } from './config';
import { prepareSuiteDatabase, type SuiteDatabase } from './database';
import { flushRateLimitCounters } from './valkey';
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
    // 1 hop: harness gán X-Forwarded-For riêng cho mỗi request chưa xác thực (né rate limit
    // register 5/giờ/IP khi seed nhiều user). rate-limit.sec.ts ghi đè lại 0.
    TRUST_PROXY_HOPS: '1',
    GIT_SHA: 'security-suite',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}

/**
 * Build đang test CỐ Ý từ chối khởi động với cấu hình này vì tính năng chưa có (vd production cần
 * repository Prisma — T-020). Chỉ khi output khởi động khớp `startupRefusal` thì cả file bị skip có
 * nhãn; mọi lỗi khởi động khác vẫn đỏ. Đặt biến `requiredEnv=1` (CI khi tính năng đã có) ⇒ không
 * bao giờ skip — lỗi khởi động là đỏ thật.
 */
export interface PendingStartup {
  label: string;
  startupRefusal: RegExp;
  requiredEnv: string;
}

/**
 * Mỗi file suite: DB riêng của suite (ADR-106, schema làm mới) + một process API thật, dọn sau
 * `afterAll` (kể cả khi test đỏ). Trả về đối tượng lười — chỉ dùng bên trong test/hook.
 */
export function useApi(
  envOverrides: Record<string, string> = {},
  pending?: PendingStartup,
): ApiUnderTest {
  const config = loadHarnessConfig();
  let db: SuiteDatabase | undefined;
  let api: RunningApi | undefined;
  let skipReason: string | undefined;

  beforeAll(async () => {
    // Mọi file dùng chung Valkey db riêng của suite ⇒ xóa bộ đếm rate limit/cache phiên của file trước.
    await flushRateLimitCounters();
    db = await prepareSuiteDatabase(config, API_DIR);
    try {
      api = await startApi(baseEnv(db.appUrl, envOverrides));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const forced = pending && process.env[pending.requiredEnv] === '1';
      if (!pending || forced || !pending.startupRefusal.test(message)) throw err;
      skipReason = `[${pending.label}] build này từ chối khởi động (đúng thiết kế) — đặt ${pending.requiredEnv}=1 để bắt buộc chạy`;
    }
  }, 180_000);

  beforeEach((ctx) => {
    if (skipReason) ctx.skip(skipReason);
  });

  afterAll(async () => {
    try {
      await api?.stop();
    } finally {
      await db?.release();
    }
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
function runPending(blockedBy: string): boolean {
  const raw = process.env.SEC_RUN_PENDING ?? '';
  if (raw === 'all') return true;
  const tags = raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.some((tag) => blockedBy.includes(tag));
}

export function pendingRoute(id: string, title: string, blockedBy: string, fn?: () => unknown) {
  const name = `[PENDING-ROUTE ${blockedBy}] ${id} — ${title}`;
  // Nghiệm thu branch có route: `SEC_RUN_PENDING=all` hoặc danh sách nhãn (vd `auth,workspaces`) khớp
  // chuỗi con của `blockedBy` ⇒ chạy thật các case ĐÃ có thân test. Case chưa có thân luôn là todo —
  // không bao giờ xanh giả.
  if (!fn) return it.todo(name);
  return runPending(blockedBy) ? it(name, fn) : it.skip(name, fn);
}

/** Case thuộc tầng khác (Playwright/k6) — chỉ liệt kê để ma trận SEC đầy đủ. */
export function outOfScope(id: string, title: string, where: string) {
  return it.todo(`[${where}] ${id} — ${title}`);
}
