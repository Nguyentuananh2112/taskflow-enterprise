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

const LOCK_PREFIX = 'taskflow-security-suite';
/** Lần chạy khác giữ khóa trong suốt 1 file (vd rate-limit.sec.ts) ⇒ chờ đủ lâu, vẫn dưới hookTimeout. */
const LOCK_WAIT_MS = Number(process.env.SEC_LOCK_WAIT_MS ?? 300_000);
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

/**
 * Khóa advisory mức session, giữ suốt 1 file: hai lần chạy suite (hai session/agent) không xóa schema
 * hay FLUSHDB Valkey của nhau. Hai khóa — theo DB đích VÀ theo Valkey (cùng db 15 nhưng khác DB
 * Postgres vẫn đụng nhau: findings D, rate-limit.sec.ts đỏ). Khóa advisory chỉ có hiệu lực trong một
 * database ⇒ luôn lấy trên DB `postgres` để mọi lần chạy cùng cluster thấy nhau. Lấy cả hai hoặc không.
 */
async function acquireLocks(config: SecurityHarnessConfig): Promise<pg.Client> {
  const keys = [
    `${LOCK_PREFIX}:pg:${config.pgHost}:${String(config.pgPort)}/${config.dbName}`,
    `${LOCK_PREFIX}:valkey:${config.redisUrl}`,
  ];
  const client = await connect(postgresUrl(config, 'migrator', 'postgres'));
  try {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const res = await client.query<{ a: boolean; b: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS a, pg_try_advisory_lock(hashtext($2)) AS b',
        keys,
      );
      const { a, b } = res.rows[0] ?? { a: false, b: false };
      if (a && b) return client;
      await client.query('SELECT pg_advisory_unlock_all()'); // không giữ một nửa ⇒ không deadlock
      if (Date.now() > deadline) {
        throw new Error(
          `DB ${config.dbName} / Valkey ${config.redisUrl} đang được một lần chạy suite khác giữ quá ${String(LOCK_WAIT_MS)}ms (SEC_LOCK_WAIT_MS)`,
        );
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
  } catch (err) {
    await client.end();
    throw err;
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
  const lock = await acquireLocks(config);
  const migratorUrl = postgresUrl(config, 'migrator');
  const ddl = await connect(migratorUrl).catch(async (err: unknown) => {
    await lock.end();
    throw err;
  });
  try {
    const app = ident(config.appUser);
    await ddl.query('DROP SCHEMA IF EXISTS public CASCADE');
    await ddl.query(`CREATE SCHEMA public AUTHORIZATION ${ident(config.migratorUser)}`);
    await ddl.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    migrate(apiDir, migratorUrl);
    await ddl.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(config.dbName)} TO ${app}`);
    await ddl.query(`GRANT USAGE ON SCHEMA public TO ${app}`);
    await ddl.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}`,
    );
    await ddl.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`);
  } catch (err) {
    await lock.end();
    throw err;
  } finally {
    await ddl.end();
  }

  return {
    appUrl: postgresUrl(config, 'app'),
    // Đóng session ⇒ Postgres tự nhả mọi khóa advisory (kể cả khi process test chết giữa chừng).
    release: () => lock.end(),
  };
}
