import { readFileSync } from 'node:fs';

/**
 * T-061 TẠM: danh sách loại tạm DUY NHẤT nằm ở `tsconfig.exclusions.json` (tsconfig kế thừa; vitest đọc ở đây).
 * Thư mục ⇒ `<dir>/**`; mẫu có `*` giữ nguyên. Rỗng ⇒ không loại gì.
 */
export function temporaryExclusionGlobs(): string[] {
  const raw = JSON.parse(
    readFileSync(new URL('./tsconfig.exclusions.json', import.meta.url), 'utf8'),
  ) as { exclude?: string[] };
  return (raw.exclude ?? []).map((p) => (/\.[a-z]+$/.test(p) || p.includes('*') ? p : `${p}/**`));
}
