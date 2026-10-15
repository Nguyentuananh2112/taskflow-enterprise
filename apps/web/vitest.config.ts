import { createRequire } from 'node:module';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

// Test web chạy jsdom (phía trình duyệt) nhưng Vitest giải gói theo điều kiện Node ⇒ `@sentry/nextjs`
// ra bản SERVER. Trỏ thẳng bản client (điều kiện `browser` của gói) để test đúng SDK mà bundle trình
// duyệt dùng (T-035, review E: header trace / patch).
const sentryClientEntry = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@sentry/nextjs/package.json')),
  'build/esm/index.client.js',
);

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@test', replacement: path.join(import.meta.dirname, 'test') },
      { find: '@', replacement: path.join(import.meta.dirname, 'src') },
      { find: /^@sentry\/nextjs$/, replacement: sentryClientEntry },
    ],
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    // Bản client của @sentry/nextjs import `next/router` (không đuôi) — để Vite xử lý thay vì Node ESM.
    server: { deps: { inline: [/@sentry\//] } },
    setupFiles: ['./test/setup-dom.ts'],
    // jsdom + react-hook-form + axe chậm gấp nhiều lần khi máy bận (nhiều phiên dev, build song song):
    // mặc định 5s làm đỏ oan dù assert đúng. 15s KHÔNG che lỗi chức năng — mọi assert giữ nguyên;
    // test treo thật vẫn đỏ. Đo trước/sau: docs/reviews/web-test-timeouts.md.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: ['src/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
