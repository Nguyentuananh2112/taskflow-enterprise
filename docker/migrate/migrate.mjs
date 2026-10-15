// Entrypoint image migrate (devops.md §4.1): `prisma migrate deploy` rồi grant DML cho taskflow_app (grant-app.sql).
// Không dùng shell — image node slim, CLI Prisma đã ghim theo lockfile (ADR-061). Bất kỳ bước nào lỗi ⇒ exit ≠ 0
// ⇒ rollout dừng. DATABASE_URL = taskflow_migrator (DDL), kết nối thẳng.
import { spawnSync } from 'node:child_process';

const prisma = (args) => {
  const { status, error } = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', ...args],
    {
      stdio: 'inherit',
    },
  );
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
};

prisma(['migrate', 'deploy']);
prisma(['db', 'execute', '--file', 'grant-app.sql']);
console.log('[migrate] xong: migrate deploy + grant DML cho taskflow_app');
