import { defineConfig, devices } from '@playwright/test';

import { apiServerEnv } from './support/api-env';
import { API_DIR, API_ORIGIN, API_URL, E2E_DIR, WEB_ORIGIN, WEB_PORT } from './support/env';

// T-026. Local: máy thiếu RAM ⇒ 1 worker, chỉ Chromium (E2E_FIREFOX=1 để thêm Firefox). CI: song song +
// Chromium + Firefox. Trace/video chỉ giữ khi fail. Không waitForTimeout cố định — chờ theo điều kiện.
const CI = !!process.env.CI;

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
    // F2: Firefox + viewport mobile. CI chạy đủ; local chỉ luồng chính (@main) để nhẹ máy.
    ...(CI || process.env.E2E_FIREFOX === '1'
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
            ...(CI ? {} : { grep: /@main/ }),
          },
        ]
      : []),
    ...(CI || process.env.E2E_MOBILE === '1'
      ? [{ name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@main/ }]
      : []),
  ],
  webServer: [
    {
      // API thật: composition root thật, Prisma (mặc định) + Valkey db 14.
      command: 'node --import tsx src/main.ts',
      cwd: API_DIR,
      url: `${API_ORIGIN}/healthz`,
      reuseExistingServer: false,
      timeout: 300_000, // máy dev dùng chung có lúc rất tải (khởi động nguội > 3 phút)
      // Log khởi động hiện trong output ⇒ server không lên được thì biết ngay vì sao.
      stdout: 'pipe',
      stderr: 'pipe',
      env: apiServerEnv(),
    },
    {
      // Web bản build production (`next build` chạy trước — globalSetup kiểm .next/BUILD_ID).
      // Giống image production: standalone server (Dockerfile web), không `next start`.
      command: 'node support/start-web.mjs',
      cwd: E2E_DIR,
      url: `${WEB_ORIGIN}/login`,
      reuseExistingServer: false,
      timeout: 300_000, // máy dev dùng chung có lúc rất tải (khởi động nguội > 3 phút)
      // Log khởi động hiện trong output ⇒ server không lên được thì biết ngay vì sao.
      stdout: 'pipe',
      stderr: 'pipe',
      // APP_MOCK_API cố ý KHÔNG đặt ⇒ web gọi API thật (mock-flag.ts).
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'test',
        API_URL,
        PORT: String(WEB_PORT),
        HOSTNAME: '127.0.0.1',
        // T-035: E2E_SENTRY_DSN đặt ⇒ bật Sentry web (tunnel /monitoring). Dùng host `.invalid` (không bao giờ
        // phân giải) để không có request nào ra Internet thật. Trống ⇒ Sentry tắt.
        SENTRY_DSN: process.env.E2E_SENTRY_DSN ?? '',
        TRUST_PROXY_HOPS: '0',
      },
    },
  ],
});
