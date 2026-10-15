import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // package.json có "type":"module" → giữ đuôi .js (Dockerfile chạy dist/main.js, devops.md §3.1).
  fixedExtension: false,
  // contracts là gói JIT (source .ts) → bundle vào; còn lại giữ external, cài qua node_modules.
  deps: { alwaysBundle: [/^@taskflow\//] },
});
