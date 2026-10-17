// Cổng gộp nhánh tích hợp `feat/company-level` vào `main` (T-061, TL chốt (a)): danh sách loại tạm
// attendance / leave / test HR ở apps/api/tsconfig.exclusions.json PHẢI rỗng. Không rỗng ⇒ exit 1.
import { readFileSync } from 'node:fs';

const file = new URL('../../apps/api/tsconfig.exclusions.json', import.meta.url);
const { exclude = [] } = JSON.parse(readFileSync(file, 'utf8'));
if (exclude.length > 0) {
  console.error(`Còn ${exclude.length} mục loại tạm trong apps/api/tsconfig.exclusions.json:`);
  for (const p of exclude) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('apps/api/tsconfig.exclusions.json: không còn mục loại tạm.');
