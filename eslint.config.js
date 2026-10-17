import { readFileSync } from 'node:fs';

import { taskflow } from '@taskflow/config/eslint';

// T-061 TẠM: cùng danh sách loại tạm của apps/api (tsconfig + vitest) — PHẢI rỗng trước khi gộp vào main
// (.github/scripts/check-temp-exclusions.mjs).
const apiTemporary = JSON.parse(
  readFileSync(new URL('./apps/api/tsconfig.exclusions.json', import.meta.url), 'utf8'),
).exclude.map((p) => `apps/api/${/\.[a-z]+$/.test(p) || p.includes('*') ? p : `${p}/**`}`);

export default taskflow({
  rootDir: import.meta.dirname,
  api: 'apps/api',
  web: 'apps/web',
  // Fixture vi phạm cố ý — chỉ được lint bởi test của packages/config.
  ignores: ['**/test/fixtures/**', ...apiTemporary],
});
