import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Phép đo hiệu năng theo ms (frontend.md §4.7) — chạy RIÊNG bằng `pnpm --filter @taskflow/web test:perf`,
// không nằm trong `pnpm test`: ngưỡng tuyệt đối phụ thuộc tốc độ máy ⇒ chập chờn khi máy bận. Bộ test
// thường chỉ khẳng định số lần render (tất định) — test/board-render-count.test.tsx.
const web = path.join(import.meta.dirname, '..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@test': path.join(web, 'test'), '@': path.join(web, 'src') },
  },
  test: {
    name: 'web-perf',
    root: web,
    environment: 'jsdom',
    setupFiles: ['./test/setup-dom.ts'],
    include: ['perf/**/*.perf.{ts,tsx}'],
    // Một file, một worker: giảm nhiễu đo; vẫn có timeout rộng vì jsdom chậm khi máy bận.
    maxWorkers: 1,
    testTimeout: 60_000,
  },
});
