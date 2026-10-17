import { afterAll, beforeAll, beforeEach, it } from 'vitest';

import { API_DIR, startApi, type RunningApi } from './api-process';
import { loadHarnessConfig } from './config';
import { prepareSuiteDatabase, type SuiteDatabase } from './database';
import { rawRequest, type RawRequest, type RawResponse } from './http-client';
import { DECLARED_PENDING, PENDING_PREFIX } from './pending';
import { baseEnv } from './suite-env';
import { flushRateLimitCounters } from './valkey';

export { baseEnv } from './suite-env';

export interface ApiUnderTest {
  readonly baseUrl: string;
  readonly webOrigin: string;
  request(req: RawRequest): Promise<RawResponse>;
  logs(): readonly string[];
  /**
   * ADR-140 (Mốc 3.5): dừng API rồi khởi động lại trên CÙNG DB / Valkey db với env ghi đè thêm (vd
   * `TEST_CLOCK_ANCHOR` tiến). Phiên cũ vẫn hợp lệ theo giờ thật. Override cộng dồn qua các lần restart.
   */
  restart(overrides: Record<string, string>): Promise<void>;
}

/** Bước chạy sau reset DB, TRƯỚC khi khởi động API (vd `admin:bootstrap` — harness/company.ts). */
export interface SuiteSetup {
  beforeStart?: (ctx: { dbUrl: string; env: Record<string, string> }) => Promise<void>;
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
  setup: SuiteSetup = {},
): ApiUnderTest {
  const config = loadHarnessConfig();
  let db: SuiteDatabase | undefined;
  let api: RunningApi | undefined;
  let skipReason: string | undefined;
  // `envOverrides` đọc LƯỜI (lúc khởi động API, không lúc đăng ký): file như valkey-outage gán REDIS_URL của
  // container tạm trong beforeAll riêng, sau khi gọi useApi. Override của `restart` cộng dồn riêng.
  let restartOverrides: Record<string, string> = {};
  const overridesNow = () => ({ ...envOverrides, ...restartOverrides });

  beforeAll(async () => {
    db = await prepareSuiteDatabase(config, API_DIR);
    // Mọi file dùng chung Valkey db riêng của suite ⇒ xóa bộ đếm rate limit/cache phiên của file trước.
    // Chỉ SAU khi giữ khóa (prepareSuiteDatabase) — trước đó sẽ xóa giữa chừng của lần chạy khác.
    await flushRateLimitCounters();
    const env = baseEnv(db.appUrl, overridesNow());
    // Lỗi bootstrap là đỏ thật — không thuộc `pending` (chỉ áp cho lỗi khởi động API).
    await setup.beforeStart?.({ dbUrl: db.appUrl, env });
    try {
      api = await startApi(env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const forced = pending && process.env[pending.requiredEnv] === '1';
      if (!pending || forced || !pending.startupRefusal.test(message)) throw err;
      skipReason = `[${pending.label}] build này từ chối khởi động (đúng thiết kế) — đặt ${pending.requiredEnv}=1 để bắt buộc chạy`;
    }
  }, 600_000);

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
    restart: async (extra) => {
      if (!db) throw new Error('restart() chỉ dùng sau beforeAll của useApi()');
      await running().stop();
      api = undefined;
      restartOverrides = { ...restartOverrides, ...extra };
      api = await startApi(baseEnv(db.appUrl, overridesNow()));
    },
  };
}

/**
 * Ca SEC trong `DECLARED_PENDING` có chạy ở lượt này không: chỉ khi `SEC_RUN_PENDING=all` hoặc danh
 * sách (phân cách bằng dấu phẩy) chứa id hoặc ticket của ca — dùng nghiệm thu branch làm tính năng.
 * Ca KHÔNG khai báo pending luôn chạy.
 */
export function caseRuns(id: string): boolean {
  const declared = DECLARED_PENDING[id];
  if (!declared) return true;
  const raw = process.env.SEC_RUN_PENDING ?? '';
  if (raw === 'all') return true;
  const tags = raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.some((tag) => tag === id || tag === declared.ticket);
}

/**
 * Một ca SEC. Mặc định CHẠY (local lẫn CI). Skip chỉ khi id có trong `DECLARED_PENDING` (lý do +
 * ticket) — mọi skip khác làm lượt chạy đỏ (`skip-budget-reporter.ts`). Chưa có thân ⇒ todo (không
 * bao giờ xanh giả). `area` chỉ để đọc tên ca (route/tính năng ca này kiểm).
 */
export function secCase(
  id: string,
  title: string,
  area: string,
  fn?: () => unknown,
  /** Case dựng/hủy hạ tầng (vd restart container Valkey) cần lâu hơn `testTimeout` 20s khi máy tải. */
  timeoutMs?: number,
) {
  if (!fn) return it.todo(`[TODO ${area}] ${id} — ${title}`);
  const declared = DECLARED_PENDING[id];
  if (declared && !caseRuns(id)) {
    return it.skip(`${PENDING_PREFIX}${declared.ticket}] ${id} — ${title}`, fn, timeoutMs);
  }
  return it(`${id} — ${title}`, fn, timeoutMs);
}

/** Case thuộc tầng khác (Playwright/k6) — chỉ liệt kê để ma trận SEC đầy đủ. */
export function outOfScope(id: string, title: string, where: string) {
  return it.todo(`[${where}] ${id} — ${title}`);
}
