import { defineConfig, devices } from '@playwright/test';

import { loadHarnessConfig, postgresUrl } from '../apps/api/test/security/harness/config';
import {
  API_DIR,
  API_ORIGIN,
  API_PORT,
  API_URL,
  E2E_DB,
  E2E_JWT_SECRET,
  E2E_REDIS_URL,
  WEB_DIR,
  WEB_ORIGIN,
  WEB_PORT,
} from './support/env';

// T-026. Local: máy thiếu RAM ⇒ 1 worker, chỉ Chromium (E2E_FIREFOX=1 để thêm Firefox). CI: song song +
// Chromium + Firefox. Trace/video chỉ giữ khi fail. Không waitForTimeout cố định — chờ theo điều kiện.
const CI = !!process.env.CI;
const db = loadHarnessConfig({ ...process.env, SEC_PG_DB: E2E_DB, SEC_REDIS_URL: E2E_REDIS_URL });

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.e2e.ts',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,
  workers: CI ? '50%' : 1,
  retries: 0,
  forbidOnly: CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(CI || process.env.E2E_FIREFOX === '1'
      ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }]
      : []),
  ],
  webServer: [
    {
      // API thật: composition root thật, Prisma (mặc định) + Valkey db 14.
      command: 'node --import tsx src/main.ts',
      cwd: API_DIR,
      url: `${API_ORIGIN}/healthz`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'test',
        APP_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: postgresUrl(db, 'app'),
        REDIS_URL: E2E_REDIS_URL,
        JWT_ACCESS_SECRET: E2E_JWT_SECRET,
        CORS_ORIGINS: WEB_ORIGIN,
        COOKIE_SECURE: 'false',
        TRUST_PROXY_HOPS: '0',
        GIT_SHA: 'e2e',
        LOG_LEVEL: 'warn',
        // E2E-11: access token sống ngắn ⇒ mọi kịch bản dài đều đi qua refresh trong suốt. API chỉ nhận
        // biến này khi APP_ENV=test (T-031); bản API chưa có thì bỏ qua (E2E-11 tự skip có nhãn).
        JWT_ACCESS_TTL_SECONDS: process.env.E2E_ACCESS_TTL ?? '10',
      },
    },
    {
      // Web bản build production (`next build` chạy trước — globalSetup kiểm .next/BUILD_ID).
      command: `node node_modules/next/dist/bin/next start --port ${String(WEB_PORT)}`,
      cwd: WEB_DIR,
      url: `${WEB_ORIGIN}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      // APP_MOCK_API cố ý KHÔNG đặt ⇒ web gọi API thật (mock-flag.ts).
      env: { NODE_ENV: 'production', APP_ENV: 'test', API_URL },
    },
  ],
});
