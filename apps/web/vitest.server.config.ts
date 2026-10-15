import path from 'node:path';

import { defineProject } from 'vitest/config';

// Project Vitest riêng cho code SERVER của web (T-035): môi trường node, KHÔNG alias `@sentry/nextjs`
// sang bản client như vitest.config.ts ⇒ test chạy đúng SDK server mà Next dùng cho route handler /
// server component. Chỉ nhận file `*.server.test.ts` (project chính loại các file này).
export default defineProject({
  resolve: {
    alias: { '@': path.join(import.meta.dirname, 'src') },
  },
  test: {
    name: 'web-server',
    environment: 'node',
    include: ['src/**/*.server.test.ts', 'app/**/*.server.test.ts'],
  },
});
