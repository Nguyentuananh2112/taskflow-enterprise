// CO-06 (test-spec-company §2; company-level §3 "Backfill tối thiểu", ADR-138): migration 5 trên DB đã có user — một
// người xóa mềm. Áp các migration trước 5 vào một SCHEMA tạm (không đụng `public` của suite), chèn user, rồi áp đúng
// file migration 5: mọi user CHƯA xóa có dòng `company_members` EMPLOYEE với `start_date` = ngày tạo theo giờ VN; user
// xóa mềm KHÔNG có dòng; không có Admin, không có dòng `companies` (⇒ `admin:bootstrap`).
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../db';

const MIGRATIONS = join(import.meta.dirname, '../../../prisma/migrations');
const COMPANY_LEVEL = '20261019000000_company_level';
const schema = `co06_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const client = new pg.Client({ connectionString: testDatabaseUrl() });

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
  await client.end();
});

const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');

describe('CO-06 migration 5 — backfill company_members', () => {
  it('user chưa xóa ⇒ EMPLOYEE (start_date theo ngày VN của created_at); user xóa mềm ⇒ không có dòng; chưa có Admin', async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirs).toContain(COMPANY_LEVEL);
    for (const dir of dirs.filter((d) => d < COMPANY_LEVEL)) await client.query(sqlOf(dir));

    // 17:30Z ngày 15 = 00:30 VN ngày 16 ⇒ start_date phải là ngày 16 (giờ VN, không phải UTC).
    const users = [
      { email: 'mia@example.test', createdAt: '2026-10-15T17:30:00.000Z', deletedAt: null },
      { email: 'max@example.test', createdAt: '2026-10-01T03:00:00.000Z', deletedAt: null },
      {
        email: 'gone@example.test',
        createdAt: '2026-09-01T03:00:00.000Z',
        deletedAt: '2026-09-20T03:00:00.000Z',
      },
    ];
    const ids: Record<string, string> = {};
    for (const u of users) {
      const id = randomUUID();
      ids[u.email] = id;
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, created_at, updated_at, deleted_at)
         VALUES ($1, $2, 'x', $3, $4, $4, $5)`,
        [id, u.email, u.email.split('@')[0], u.createdAt, u.deletedAt],
      );
    }

    await client.query(sqlOf(COMPANY_LEVEL));

    const rows = await client.query<{
      user_id: string;
      role: string;
      start_date: string;
      grants: string[];
    }>(
      `SELECT user_id, role::text AS role, to_char(start_date, 'YYYY-MM-DD') AS start_date,
              grants::text[] AS grants
         FROM company_members ORDER BY start_date`,
    );
    expect(rows.rows).toEqual([
      { user_id: ids['max@example.test'], role: 'EMPLOYEE', start_date: '2026-10-01', grants: [] },
      { user_id: ids['mia@example.test'], role: 'EMPLOYEE', start_date: '2026-10-16', grants: [] },
    ]);
    const admins = await client.query(`SELECT 1 FROM company_members WHERE role = 'ADMIN'`);
    expect(admins.rowCount).toBe(0);
    const company = await client.query(`SELECT 1 FROM companies`);
    expect(company.rowCount).toBe(0);
  });
});
