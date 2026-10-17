// SEC-HR-64b (test-spec-company §3; ADR-137, ADR-138, R38) ở TẦNG I — F quyết: hộp đen không chèn DB (ADR-140),
// mà trạng thái "chưa có Admin + nhân viên đã có mật khẩu" chỉ do backfill của migration 5 tạo ra. Seed đúng dòng
// backfill sinh (`users` + `company_members(EMPLOYEE)`), gọi CLI `admin:bootstrap --json` THẬT với cùng DB, rồi khẳng
// định trên DB: nâng ADMIN, đóng nhiệm kỳ ROLE_CHANGED, thu hồi phiên, mật khẩu giữ nguyên, không token kích hoạt.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { testEnvVars } from '../../support';
import { testDatabaseUrl } from '../db';
import {
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
  testValkeyUrl,
} from '../support/prisma-test-kit';

const API_DIR = resolve(import.meta.dirname, '../../..');
const HASH = '$argon2id$v=19$m=47104,t=1,p=1$c2VlZC1zYWx0LXRlc3Q$ZmFrZS1oYXNoLWZvci10ZXN0LW9ubHk';

function bootstrap(email: string, args: string[] = ['--json']) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/admin-bootstrap.ts', ...args], {
    cwd: API_DIR,
    env: {
      ...process.env,
      ...testEnvVars({
        DATABASE_URL: testDatabaseUrl(),
        REDIS_URL: testValkeyUrl(),
        PERSISTENCE: 'prisma',
      }),
      BOOTSTRAP_ADMIN_EMAIL: email,
      BOOTSTRAP_ADMIN_NAME: 'Legacy Admin',
      COMPANY_NAME: 'Công ty Backfill',
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

let legacy: { id: string; email: string };

beforeEach(async () => {
  await resetDatabase();
  const prisma = testPrisma();
  const email = `legacy-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: { email, fullName: 'Legacy', passwordHash: HASH, tokenVersion: 3 },
  });
  // = dòng backfill của migration 5: mọi user cũ ⇒ EMPLOYEE từ ngày tạo, không Admin, chưa có dòng companies.
  await prisma.companyMember.create({
    data: { userId: user.id, role: 'EMPLOYEE', startDate: new Date('2026-01-05T00:00:00Z') },
  });
  legacy = { id: user.id, email };
});
afterAll(disconnectTestPrisma);

describe('admin:bootstrap với email của nhân viên đã có mật khẩu (SEC-HR-64b)', () => {
  it('nâng ADMIN (grants rỗng), đóng nhiệm kỳ ROLE_CHANGED, thu hồi phiên, giữ mật khẩu, không token kích hoạt', async () => {
    const cli = bootstrap(legacy.email);
    expect(cli.status, cli.stderr).toBe(0);
    const lines = cli.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({ userId: legacy.id, activation: null });

    const prisma = testPrisma();
    expect(await prisma.companyMember.findUnique({ where: { userId: legacy.id } })).toMatchObject({
      role: 'ADMIN',
      grants: [],
      startDate: null,
    });
    expect(await prisma.companyMemberDeparture.findMany()).toMatchObject([
      { userId: legacy.id, role: 'EMPLOYEE', reason: 'ROLE_CHANGED' },
    ]);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(user.passwordHash).toBe(HASH);
    expect(user.tokenVersion).toBeGreaterThan(3); // phiên cũ (quyền EMPLOYEE) bị thu hồi — ADR-105
    expect(await prisma.accountActivationToken.count()).toBe(0);
    expect(await prisma.company.findMany()).toMatchObject([{ id: 1, name: 'Công ty Backfill' }]);
    const audit = await prisma.hrAuditLog.findMany();
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((a) => a.actorId === null)).toBe(true); // CLI không có người thao tác (R38)
  });

  it('chạy lại sau khi đã nâng ⇒ thoát 1 "Đã có Admin", không đổi gì', async () => {
    expect(bootstrap(legacy.email).status).toBe(0);
    const before = await testPrisma().companyMemberDeparture.count();
    const again = bootstrap(`other-${legacy.email}`);
    expect(again.status, again.stderr).toBe(1);
    expect(again.stderr).toContain('Đã có Admin');
    expect(again.stdout).toBe('');
    expect(await testPrisma().user.count()).toBe(1);
    expect(await testPrisma().companyMemberDeparture.count()).toBe(before);
  });
});
