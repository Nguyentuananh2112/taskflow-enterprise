import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadHarnessConfig } from '../../apps/api/test/security/harness/config';
import { prepareSuiteDatabase } from '../../apps/api/test/security/harness/database';
import { API_DIR, E2E_DB, E2E_REDIS_URL, WEB_DIR } from './env';

/**
 * Chuẩn bị hạ tầng MỘT lần (T-026): DB riêng `taskflow_e2e` (schema mới + migrate, ADR-106) — dùng lại
 * `prepareSuiteDatabase` của suite bảo mật (cùng khóa advisory theo DB + Valkey, cùng cách cấp quyền).
 * Khóa giữ tới teardown ⇒ hai lần chạy E2E không xóa DB của nhau. Lỗi hạ tầng ⇒ báo rõ, không phải lỗi test.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(join(WEB_DIR, '.next', 'BUILD_ID'))) {
    throw new Error(
      '[hạ tầng E2E] web chưa build production — chạy `pnpm --filter @taskflow/web build` trước (T-026 chạy `next start`).',
    );
  }
  const config = loadHarnessConfig({
    ...process.env,
    SEC_PG_DB: E2E_DB,
    SEC_REDIS_URL: E2E_REDIS_URL,
  });
  try {
    const db = await prepareSuiteDatabase(config, API_DIR);
    return () => db.release();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[hạ tầng E2E] chuẩn bị DB ${E2E_DB} lỗi — không phải lỗi test:\n${message}`, {
      cause: err,
    });
  }
}
