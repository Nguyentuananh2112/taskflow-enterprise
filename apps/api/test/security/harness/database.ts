import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import pg from 'pg';

import { postgresUrl, type SecurityHarnessConfig } from './config';

/** DB của suite đã sẵn sàng cho một file: schema mới, đã migrate, đang giữ khóa độc quyền. */
export interface SuiteDatabase {
  appUrl: string;
  release(): Promise<void>;
}

const LOCK_KEY = 'taskflow-security-suite';
const LOCK_WAIT_MS = 120_000;
/** Máy dev dùng chung có lúc rất tải (Stryker của người khác) ⇒ CLI Prisma khởi động chậm. */
const MIGRATE_TIMEOUT_MS = Number(process.env.SEC_MIGRATE_TIMEOUT_MS ?? 300_000);
const ident = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Tạo DB riêng nếu chưa có (migrator có CREATEDB ⇒ thành owner). Không bao giờ DROP DATABASE. */
async function ensureDatabase(config: SecurityHarnessConfig): Promise<void> {
  const admin = await connect(postgresUrl(config, 'migrator', 'postgres'));
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      config.dbName,
    ]);
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE ${ident(config.dbName)}`);
  } finally {
    await admin.end();
  }
}

/** Khóa advisory mức session: hai lần chạy suite (hai session/agent) không xóa schema của nhau. */
async function acquireLock(client: pg.Client, dbName: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const res = await client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS ok',
      [LOCK_KEY],
    );
    if (res.rows[0]?.ok) return;
    if (Date.now() > deadline) {
      throw new Error(`DB ${dbName} đang được một lần chạy suite khác giữ quá ${LOCK_WAIT_MS}ms`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/** `prisma migrate deploy` bằng CLI trong node_modules của API đang test (ADR-061: không npx). */
function migrate(apiDir: string, migratorUrl: string): void {
  if (!existsSync(join(apiDir, 'prisma', 'migrations'))) return; // build chưa có Prisma
  const cli = createRequire(join(apiDir, 'package.json')).resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: apiDir,
    env: {
      PATH: process.env.PATH ?? '',
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}),
      DATABASE_URL: migratorUrl,
      // CLI Prisma gọi mạng kiểm tra bản mới (checkpoint) — trên mạng chậm có thể treo hàng phút.
      CHECKPOINT_DISABLE: '1',
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
    encoding: 'utf8',
    timeout: MIGRATE_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    const why = result.error
      ? `${result.error.message} (signal ${result.signal ?? '-'})`
      : `exit ${String(result.status)}`;
    throw new Error(`prisma migrate deploy thất bại — ${why}:\n${result.stdout}\n${result.stderr}`);
  }
}

/**
 * Chuẩn bị DB riêng cho một file suite (ADR-106): khóa → xóa + tạo lại schema `public` → migrate →
 * cấp quyền DML cho user app (DEFAULT PRIVILEGES của init script chỉ có ở DB tạo lúc khởi tạo container).
 */
export async function prepareSuiteDatabase(
  config: SecurityHarnessConfig,
  apiDir: string,
): Promise<SuiteDatabase> {
  await ensureDatabase(config);
  const migratorUrl = postgresUrl(config, 'migrator');
  const lock = await connect(migratorUrl);
  try {
    await acquireLock(lock, config.dbName);
    const app = ident(config.appUser);
    await lock.query('DROP SCHEMA IF EXISTS public CASCADE');
    await lock.query(`CREATE SCHEMA public AUTHORIZATION ${ident(config.migratorUser)}`);
    await lock.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    migrate(apiDir, migratorUrl);
    await lock.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(config.dbName)} TO ${app}`);
    await lock.query(`GRANT USAGE ON SCHEMA public TO ${app}`);
    await lock.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}`,
    );
    await lock.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`);
  } catch (err) {
    await lock.end();
    throw err;
  }

  return {
    appUrl: postgresUrl(config, 'app'),
    release: async () => {
      try {
        await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
      } finally {
        await lock.end();
      }
    },
  };
}
