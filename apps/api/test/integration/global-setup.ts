import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { createClient } from 'redis';
import type { TestProject } from 'vitest/node';

import { createTestPrisma, testDatabaseUrl } from './db';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Thư mục riêng của lượt chạy — serial-guard.ts đặt cờ "đang có file chạy" trong đó. */
    integrationRunDir: string;
  }
}

/** Gọi đúng CLI Prisma đã pin trong node_modules (không `npx`, ADR-061), không phụ thuộc PATH. */
export function runPrisma(args: string[], databaseUrl: string): void {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [cli, ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

const LOCK_PREFIX = 'taskflow-integration';
/** Lượt khác đang giữ cùng DB/Valkey ⇒ chờ tối đa chừng này rồi TỪ CHỐI (không chạy test nào). 0 ⇒ từ chối ngay. */
const LOCK_WAIT_MS = Number(process.env.INTEGRATION_LOCK_WAIT_MS ?? 600_000);

/** Valkey của integration phải là db 1–15 ghi RÕ trong URL: lượt chạy FLUSHDB db đó, không bao giờ db 0. */
export function integrationValkeyUrl(raw = process.env.VALKEY_URL_TEST): string {
  if (!raw) throw new Error('Thiếu VALKEY_URL_TEST (integration cần Valkey thật)');
  const db = new URL(raw).pathname.replace(/^\//, '');
  if (!/^(?:[1-9]|1[0-5])$/.test(db)) {
    throw new Error(
      `VALKEY_URL_TEST phải chỉ rõ db 1–15 riêng của lượt chạy (vd redis://127.0.0.1:6380/9): mỗi lượt FLUSHDB db đó — nhận "${raw.replace(/\/\/[^@]*@/, '//***@')}"`,
    );
  }
  return raw;
}

/** Định danh không chứa mật khẩu — dùng làm khóa advisory và trong thông báo lỗi. */
function target(raw: string): string {
  const u = new URL(raw);
  return `${u.hostname}:${u.port}${u.pathname}`;
}

/**
 * Khóa advisory mức session, giữ SUỐT lượt chạy: lượt thứ hai trên cùng DB Postgres hoặc cùng Valkey db
 * chờ (tối đa INTEGRATION_LOCK_WAIT_MS) rồi từ chối — không bao giờ DROP SCHEMA / TRUNCATE / FLUSHDB
 * giữa chừng lượt kia. Khóa advisory chỉ thấy nhau trong một database ⇒ lấy trên DB `postgres` của
 * cùng cluster. Lấy cả hai hoặc không (như harness security, T-017 findings D3).
 */
async function acquireRunLock(dbUrl: string, valkeyUrl: string): Promise<pg.Client> {
  const lockUrl = new URL(dbUrl);
  lockUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: lockUrl.toString() });
  client.on('error', (err) => {
    console.error(`[hạ tầng test] mất kết nối giữ khóa integration (${err.message})`);
  });
  await client.connect();
  const keys = [`${LOCK_PREFIX}:pg:${target(dbUrl)}`, `${LOCK_PREFIX}:valkey:${target(valkeyUrl)}`];
  try {
    const deadline = Date.now() + LOCK_WAIT_MS;
    let announced = false;
    for (;;) {
      const res = await client.query<{ a: boolean; b: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS a, pg_try_advisory_lock(hashtext($2)) AS b',
        keys,
      );
      const { a, b } = res.rows[0] ?? { a: false, b: false };
      if (a && b) return client;
      await client.query('SELECT pg_advisory_unlock_all()'); // không giữ một nửa ⇒ không deadlock
      if (Date.now() >= deadline) {
        throw new Error(
          `TỪ CHỐI chạy integration: DB ${target(dbUrl)} / Valkey ${target(valkeyUrl)} đang được một lượt khác giữ quá ${String(LOCK_WAIT_MS)}ms (INTEGRATION_LOCK_WAIT_MS). Không test nào đã chạy, dữ liệu lượt kia không bị đụng. Dùng DB/Valkey db riêng (ADR-106) hoặc chờ lượt kia xong.`,
        );
      }
      if (!announced) {
        console.warn(
          `[integration] DB ${target(dbUrl)} / Valkey ${target(valkeyUrl)} đang bận (lượt khác) — chờ tối đa ${String(LOCK_WAIT_MS)}ms…`,
        );
        announced = true;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
  } catch (err) {
    await client.end();
    throw err;
  }
}

async function flushValkey(url: string): Promise<void> {
  const client = createClient({ url, socket: { connectTimeout: 5_000, reconnectStrategy: false } });
  client.on('error', () => undefined); // lỗi trả qua promise của connect()/flushDb()
  await client.connect();
  try {
    await client.flushDb();
  } finally {
    await client.close();
  }
}

/**
 * Khóa lượt chạy → FLUSHDB Valkey db riêng → dựng lại schema bằng chính migration production.
 * Trả về teardown: nhả khóa (đóng session ⇒ Postgres tự nhả, kể cả khi tiến trình chết giữa chừng).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const url = testDatabaseUrl();
  const valkeyUrl = integrationValkeyUrl();
  const lock = await acquireRunLock(url, valkeyUrl);
  const runDir = mkdtempSync(join(tmpdir(), 'taskflow-it-'));
  const teardown = async () => {
    rmSync(runDir, { recursive: true, force: true });
    await lock.end();
  };
  try {
    await flushValkey(valkeyUrl);
    const prisma = createTestPrisma();
    try {
      await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
      await prisma.$executeRawUnsafe('CREATE SCHEMA public');
    } finally {
      await prisma.$disconnect();
    }
    runPrisma(['migrate', 'deploy'], url);
  } catch (err) {
    await teardown();
    throw err;
  }
  project.provide('integrationRunDir', runDir);
  return teardown;
}
