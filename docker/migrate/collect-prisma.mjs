// Gom bộ chạy `prisma migrate deploy` TỐI THIỂU cho image migrate (T-022): Prisma CLI + đúng các gói nó cần
// (đúng phiên bản trong pnpm-lock vì lấy từ node_modules/.pnpm đã cài bằng --frozen-lockfile), prisma.config.ts
// và thư mục prisma/ (schema + migrations). Không có source app, không devDependencies khác.
//
//   node docker/migrate/collect-prisma.mjs <apps/api> <thư-mục-đích>
//
// Bố cục pnpm: gói X nằm ở node_modules/.pnpm/<id>/node_modules/X, phụ thuộc của X là symlink anh em trong
// cùng .pnpm/<id>/node_modules. Chép nguyên các thư mục .pnpm/<id> cần thiết (giữ symlink tương đối) là đủ.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const [apiDirArg, outDirArg] = process.argv.slice(2);
if (!apiDirArg || !outDirArg) {
  console.error('Cách dùng: collect-prisma.mjs <apps/api> <thư-mục-đích>');
  process.exit(2);
}
const apiDir = resolve(apiDirArg);
const outDir = resolve(outDirArg);

/** Thư mục `.pnpm/<id>` chứa gói tại `pkgDir` (…/.pnpm/<id>/node_modules/[@scope/]name). */
function storeEntryOf(pkgDir) {
  const parts = pkgDir.split(sep);
  const i = parts.lastIndexOf('.pnpm');
  if (i < 0) throw new Error(`Không phải bố cục pnpm: ${pkgDir}`);
  return { root: parts.slice(0, i + 1).join(sep), id: parts[i + 1] };
}

// Postgres nhúng (pglite, 24 MB) chỉ dùng cho `prisma dev`. KHÔNG loại được @prisma/studio-core / @prisma/dev:
// cli.js `require` chúng ngay khi khởi động (đã thử — MODULE_NOT_FOUND).
// Bỏ để image migrate nhỏ (T-022); nếu Prisma đổi cách nạp, smoke `migrate deploy` trong CI/runbook sẽ đỏ ngay.
// Ghi đè: COLLECT_PRISMA_EXCLUDE="a,b" (chuỗi rỗng = không loại gì).
const EXCLUDE = new Set(
  (process.env.COLLECT_PRISMA_EXCLUDE ?? '@electric-sql/pglite')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);

const prismaDir = realpathSync(join(apiDir, 'node_modules', 'prisma'));
const { root: pnpmRoot } = storeEntryOf(prismaDir);
const entries = new Set();
const queue = [prismaDir];
const seen = new Set();

while (queue.length > 0) {
  const pkgDir = queue.pop();
  if (seen.has(pkgDir)) continue;
  seen.add(pkgDir);
  entries.add(storeEntryOf(pkgDir).id);

  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  // Peer bắt buộc (vd `effect` của @prisma/config) phải có; peer OPTIONAL (vd typescript) thì bỏ — CLI migrate không cần.
  const optionalPeers = new Set(
    Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta?.optional)
      .map(([name]) => name),
  );
  const requiredPeers = Object.keys(manifest.peerDependencies ?? {}).filter(
    (n) => !optionalPeers.has(n),
  );
  const deps = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...requiredPeers,
  ];
  // Phụ thuộc là anh em của gói trong .pnpm/<id>/node_modules (gói có scope thì lùi thêm 1 cấp).
  const siblingsDir = manifest.name.startsWith('@') ? dirname(dirname(pkgDir)) : dirname(pkgDir);
  for (const dep of deps) {
    if (EXCLUDE.has(dep)) continue;
    const depPath = join(siblingsDir, dep);
    if (existsSync(depPath)) queue.push(realpathSync(depPath)); // optional/peer không cài ⇒ bỏ qua
  }
}

mkdirSync(join(outDir, 'node_modules', '.pnpm'), { recursive: true });
for (const id of entries) {
  cpSync(join(pnpmRoot, id), join(outDir, 'node_modules', '.pnpm', id), {
    recursive: true,
    verbatimSymlinks: true,
  });
}
// node_modules/prisma → .pnpm/<id>/node_modules/prisma (để `prisma/config` resolve được từ prisma.config.ts).
const prismaLink = join(outDir, 'node_modules', 'prisma');
const prismaTarget = join(
  outDir,
  'node_modules',
  '.pnpm',
  storeEntryOf(prismaDir).id,
  'node_modules',
  'prisma',
);
// Linux (Docker): symlink tương đối như pnpm. Windows không có quyền tạo symlink ⇒ junction (cần đường dẫn tuyệt đối).
if (process.platform === 'win32') symlinkSync(prismaTarget, prismaLink, 'junction');
else symlinkSync(relative(dirname(prismaLink), prismaTarget), prismaLink, 'dir');

cpSync(join(apiDir, 'prisma'), join(outDir, 'prisma'), { recursive: true });
cpSync(join(apiDir, 'prisma.config.ts'), join(outDir, 'prisma.config.ts'));
// package.json tối thiểu: "type": "module" cho prisma.config.ts dạng ESM như ở apps/api.
writeFileSync(
  join(outDir, 'package.json'),
  `${JSON.stringify({ name: 'taskflow-migrate', private: true, type: 'module' }, null, 2)}\n`,
);

const version = JSON.parse(readFileSync(join(prismaDir, 'package.json'), 'utf8')).version;
console.log(`[collect-prisma] prisma ${version}: ${entries.size} gói → ${outDir}`);
