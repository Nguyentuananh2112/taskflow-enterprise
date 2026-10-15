import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Lượt chạy board với API THẬT (T-025 "Done"): REST + Socket.io thật, cây app thật trong jsdom.
// KHÔNG nằm trong `pnpm test`/CI — cần API :4000 đang chạy (CORS_ORIGINS gồm http://localhost:3001).
// Chạy: `REAL_API_URL=http://localhost:4000/api/v1 pnpm --filter @taskflow/web test:real-api`.
const web = path.join(import.meta.dirname, '..');

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@test': path.join(web, 'test'), '@': path.join(web, 'src') } },
  test: {
    name: 'web-real-api',
    root: web,
    environment: 'jsdom',
    // Origin của "trang" = origin web đã whitelist ở API (refresh/logout + handshake socket kiểm Origin).
    environmentOptions: { jsdom: { url: 'http://localhost:3001/' } },
    setupFiles: ['./test/setup-dom.ts'],
    include: ['real-api/**/*.real.{ts,tsx}'],
    maxWorkers: 1,
    testTimeout: 60_000,
  },
});
