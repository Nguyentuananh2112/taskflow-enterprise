import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { createTestPrisma, testDatabaseUrl } from './db';

/** Gọi đúng CLI Prisma đã pin trong node_modules (không `npx`, ADR-061), không phụ thuộc PATH. */
export function runPrisma(args: string[], databaseUrl: string): void {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [cli, ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

/** Dựng lại schema từ đầu bằng chính migration sẽ chạy ở production. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const prisma = createTestPrisma();
  try {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await prisma.$disconnect();
  }
  runPrisma(['migrate', 'deploy'], url);
}
