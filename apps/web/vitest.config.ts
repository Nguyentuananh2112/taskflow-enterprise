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
    include: ['src/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
