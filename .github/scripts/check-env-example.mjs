// CI: apps/api/.env.example phải khớp 1-1 với các khóa của EnvSchema trong apps/api/src/config/env.ts (ADR-098)
// + `FILES_ENV_SHAPE` của env-files.ts (Mốc 6).
// Đọc tĩnh (không import TS): khóa schema = dòng thụt 4 khoảng trắng dạng `NAME:` trong `.object({ … })`;
// khóa example = dòng `NAME=` hoặc `# NAME=` (biến tùy chọn để comment).
import { readFileSync } from 'node:fs';

const envTs = readFileSync('apps/api/src/config/env.ts', 'utf8');
const start = envTs.indexOf('.object({');
const end = envTs.indexOf('.superRefine', start);
if (start < 0 || end < 0) {
  console.error(
    '::error::Không tìm thấy `.object({ … }).superRefine` trong env.ts — cập nhật script này.',
  );
  process.exit(1);
}
const schemaKeys = new Set(
  [...envTs.slice(start, end).matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]),
);
// Mốc 6: biến kho tệp / chat tách sang env-files.ts (`FILES_ENV_SHAPE`, spread vào schema) — khóa thụt 2 khoảng trắng.
const filesTs = readFileSync('apps/api/src/config/env-files.ts', 'utf8');
const shapeStart = filesTs.indexOf('export const FILES_ENV_SHAPE = {');
if (shapeStart < 0 || !envTs.includes('...FILES_ENV_SHAPE')) {
  console.error(
    '::error::Không tìm thấy FILES_ENV_SHAPE (env-files.ts) / spread trong env.ts — cập nhật script này.',
  );
  process.exit(1);
}
const shapeEnd = filesTs.indexOf('\n};', shapeStart);
for (const m of filesTs.slice(shapeStart, shapeEnd).matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)) {
  schemaKeys.add(m[1]);
}
const exampleKeys = new Set(
  [...readFileSync('apps/api/.env.example', 'utf8').matchAll(/^(?:# ?)?([A-Z][A-Z0-9_]+)=/gm)].map(
    (m) => m[1],
  ),
);

const missing = [...schemaKeys].filter((k) => !exampleKeys.has(k));
const extra = [...exampleKeys].filter((k) => !schemaKeys.has(k));
if (missing.length || extra.length) {
  if (missing.length) console.error(`::error::.env.example thiếu: ${missing.join(', ')}`);
  if (extra.length)
    console.error(`::error::.env.example thừa (không có trong env.ts): ${extra.join(', ')}`);
  process.exit(1);
}
console.log(`apps/api/.env.example khớp env.ts (${schemaKeys.size} biến).`);
