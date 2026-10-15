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
      // T-009: core ≥ 90%. ADR-074 / devops.md §8.2 (O11): domain ≥ 90/85, application ≥ 80/75
      // (lines·statements / branches). Glob gộp mọi module — module mới tự vào ngưỡng. Đo lúc bật
      // (main 2178744): domain 98.5/100, application 99.3/93.4 — KHÔNG hạ ngưỡng khi tụt, viết test.
      thresholds: {
        'src/core/**': { lines: 90, statements: 90, functions: 90, branches: 85 },
        'src/modules/*/domain/**': { lines: 90, statements: 90, branches: 85 },
        'src/modules/*/application/**': { lines: 80, statements: 80, branches: 75 },
      },
    },
  },
});
