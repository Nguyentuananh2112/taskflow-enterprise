import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'config',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // ESLint (typescript-eslint parser) + dependency-cruiser khởi động chậm trên Windows; beforeAll
    // lint ~50 fixture nên cần hookTimeout dài khi máy bận (CI, nhiều worker song song).
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
