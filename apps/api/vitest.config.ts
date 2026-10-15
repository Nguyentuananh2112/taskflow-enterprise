import { defineConfig } from 'vitest/config';

// defineConfig (không phải defineProject): coverage chỉ cấu hình được ở config gốc —
// `pnpm --filter @taskflow/api test:coverage` chạy file này làm gốc để áp ngưỡng core ≥ 90%.
export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Lần gọi HTTP đầu tiên mỗi file phải nạp cả app (express, pino, zod, socket.io…) — khi chạy song
    // song ~80 file trên máy/CI bận có thể > 5s mặc định (đo được 7–11s) ⇒ nới để không flaky.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/generated/**'],
      // T-009: core ≥ 90%. Ngưỡng domain/application theo devops.md §8.2 thêm khi có module (Phase 2).
      thresholds: {
        'src/core/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
      },
    },
  },
});
