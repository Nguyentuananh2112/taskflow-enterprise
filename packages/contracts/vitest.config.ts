import { defineConfig } from 'vitest/config';

// defineConfig (không phải defineProject): coverage chỉ cấu hình được ở config gốc —
// `pnpm --filter @taskflow/contracts test:coverage` chạy file này làm gốc để áp ngưỡng (giống apps/api).
export default defineConfig({
  test: {
    name: 'contracts',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // ADR-074 / devops.md §8.2 (O11): contracts ≥ 80% lines/statements. Đo lúc bật (main 07d9176):
      // 100% lines/statements/functions, 95.45% branches — KHÔNG hạ ngưỡng khi tụt, viết test.
      thresholds: { lines: 80, statements: 80 },
    },
  },
});
