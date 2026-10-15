import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: {
      '@test': path.join(import.meta.dirname, 'test'),
      '@': path.join(import.meta.dirname, 'src'),
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./test/setup-dom.ts'],
    // jsdom + react-hook-form + axe chậm gấp nhiều lần khi máy bận (nhiều phiên dev, build song song):
    // mặc định 5s làm đỏ oan dù assert đúng. 15s KHÔNG che lỗi chức năng — mọi assert giữ nguyên;
    // test treo thật vẫn đỏ. Đo trước/sau: docs/reviews/web-test-timeouts.md.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: ['src/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
