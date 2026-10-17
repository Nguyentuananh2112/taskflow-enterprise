import { defineConfig } from 'tsdown';

export default defineConfig({
  // `dist/cli/admin-bootstrap.js` — Admin đầu tiên ở production (ADR-137).
  entry: { main: 'src/main.ts', 'cli/admin-bootstrap': 'src/cli/admin-bootstrap.ts' },
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
