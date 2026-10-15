// Chạy web giống image production (apps/web/Dockerfile): output standalone + copy static/public
// (standalone KHÔNG tự copy) rồi `node apps/web/server.js`. `next start` không dùng được với standalone.
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const standalone = join(web, '.next', 'standalone');
const appDir = join(standalone, 'apps', 'web');
if (!existsSync(join(appDir, 'server.js'))) {
  throw new Error(
    `[hạ tầng E2E] thiếu ${appDir}/server.js — chạy \`pnpm --filter @taskflow/web build\``,
  );
}
cpSync(join(web, '.next', 'static'), join(appDir, '.next', 'static'), { recursive: true });
if (existsSync(join(web, 'public')))
  cpSync(join(web, 'public'), join(appDir, 'public'), { recursive: true });
process.chdir(appDir);
await import(pathToFileURL(join(appDir, 'server.js')).href);
