import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { runBootstrap } from '../../apps/api/test/security/harness/company-bootstrap';
import { loadHarnessConfig } from '../../apps/api/test/security/harness/config';
import { prepareSuiteDatabase } from '../../apps/api/test/security/harness/database';
import { apiServerEnv } from './api-env';
import { API_DIR, API_URL, E2E_DB, E2E_REDIS_URL, WEB_DIR, WEB_ORIGIN } from './env';

/**
 * Chuẩn bị hạ tầng MỘT lần (T-026): DB riêng `taskflow_e2e` (schema mới + migrate, ADR-106) — dùng lại
 * `prepareSuiteDatabase` của suite bảo mật (cùng khóa advisory theo DB + Valkey, cùng cách cấp quyền).
 * Khóa giữ tới teardown ⇒ hai lần chạy E2E không xóa DB của nhau. Lỗi hạ tầng ⇒ báo rõ, không phải lỗi test.
 *
 * Mốc 3.5 (ADR-140, test-spec-company §1.1): sau reset chạy `admin:bootstrap --json` (CLI thật, cùng env với API)
 * rồi kích hoạt Admin đầu tiên (Ada) qua API — webServer đã chạy trước globalSetup (Playwright). Thông tin đăng
 * nhập của Ada ghi vào process.env ⇒ worker (sinh sau globalSetup) đọc qua `support/company.ts`.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(join(WEB_DIR, '.next', 'standalone', 'apps', 'web', 'server.js'))) {
    throw new Error(
      '[hạ tầng E2E] web chưa build production — chạy `pnpm --filter @taskflow/web build` trước (T-026 chạy `next start`).',
    );
  }
  const config = loadHarnessConfig({
    ...process.env,
    SEC_PG_DB: E2E_DB,
    SEC_REDIS_URL: E2E_REDIS_URL,
  });
  let release: (() => Promise<void>) | undefined;
  try {
    const db = await prepareSuiteDatabase(config, API_DIR);
    release = () => db.release();
    await bootstrapAda();
    return release;
  } catch (err) {
    await release?.();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[hạ tầng E2E] chuẩn bị DB ${E2E_DB} / bootstrap Admin lỗi — không phải lỗi test:\n${message}`,
      { cause: err },
    );
  }
}

async function bootstrapAda(): Promise<void> {
  const id = randomUUID();
  const email = `ada-${id}@e2e.example`;
  const password = `e2e-${id.slice(0, 8)}-admin-passphrase`;
  const boot = await runBootstrap(apiServerEnv(), {
    email,
    name: 'E2E Ada',
    company: 'Công ty E2E',
  });
  const res = await fetch(`${API_URL}/auth/activate`, {
    method: 'POST',
    headers: { origin: WEB_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ token: boot.token, password }),
  });
  if (res.status !== 200) {
    throw new Error(
      `POST /auth/activate (Ada) — ${String(res.status)}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  process.env.E2E_ADA_ID = boot.userId;
  process.env.E2E_ADA_EMAIL = email;
  process.env.E2E_ADA_PASSWORD = password;
}
