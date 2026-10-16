// ADR-061: Prisma CLI luôn chạy bằng `pnpm exec prisma` (bản ghim theo lockfile) — `npx prisma` có thể kéo bản
// chưa ghim (Prisma 8 RC). Chạy ở CI (job static) VÀ trong `pnpm verify` để lỗi lộ ra ở máy trước khi lên CI.
// Bỏ qua dòng chú thích (`//`, `#`, `*`, `/*`) — lượt CI đầu trên GitHub đỏ vì chú thích nhắc chính luật này trong
// schema.prisma. Bỏ qua *.md (tài liệu được phép nêu ví dụ) và chính file này.
import { spawnSync } from 'node:child_process';

const PATTERN = ['npx', '+prisma'].join(' '); // ghép để file này không tự khớp
const SELF = '.github/scripts/check-no-npx-prisma.mjs';
const res = spawnSync('git', ['grep', '-nE', PATTERN, '--', ':!*.md', `:!${SELF}`], {
  encoding: 'utf8',
});
if (res.status !== 0 && res.status !== 1) {
  console.error(res.stderr || `git grep lỗi (exit ${String(res.status)})`);
  process.exit(2);
}
const hits = (res.stdout ?? '')
  .split('\n')
  .filter(Boolean)
  .filter((line) => {
    const text = line.replace(/^[^:]+:\d+:/, '').trimStart();
    return !/^(\/\/|#|\*|\/\*)/.test(text);
  });
if (hits.length) {
  for (const h of hits) console.error(h);
  console.error("::error::Dùng 'pnpm exec prisma', không dùng npx cho Prisma (ADR-061)");
  process.exit(1);
}
console.log('Không có lời gọi npx cho Prisma ngoài chú thích/tài liệu (ADR-061).');
