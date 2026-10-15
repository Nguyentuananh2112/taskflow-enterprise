import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'config',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // ESLint (typescript-eslint parser) + dependency-cruiser khởi động chậm trên Windows.
    testTimeout: 30_000,
  },
});
