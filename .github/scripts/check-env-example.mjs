// CI: apps/api/.env.example phải khớp 1-1 với các khóa của EnvSchema trong apps/api/src/config/env.ts (ADR-098).
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
