import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
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
