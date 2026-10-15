import { defineConfig } from 'vitest/config';

// Integration với Postgres thật (ADR-003). KHÔNG nằm trong `pnpm test` mặc định vì cần DB.
// Chạy: DATABASE_URL_TEST=postgresql://… pnpm --filter @taskflow/api test:integration
// CẢNH BÁO: globalSetup XÓA SẠCH schema `public` của DB trong DATABASE_URL_TEST.
export default defineConfig({
  test: {
    name: 'api-integration',
    environment: 'node',
    include: ['test/integration/**/*.int.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
