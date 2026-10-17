import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect } from 'vitest';

import { PrismaClient } from '../../src/generated/prisma/client';
import { Argon2idPasswordHasher } from '../../src/modules/auth/infrastructure/security/argon2id-password-hasher';
import { Actors } from './harness/actors';
import { bootstrapEnv, parseBootstrapOutput, runBootstrapRaw } from './harness/company-bootstrap';
import { secCase, useApi } from './harness/suite';

// SEC-HR-64 (test-spec-company §3; ADR-137, R38): CLI `admin:bootstrap` gọi trực tiếp (runBootstrapRaw — stdin
// `ignore` ⇒ KHÔNG có TTY), không qua API. API của file chỉ để kiểm hệ quả bằng đường công khai (login, /auth/me).
//
// Điều kiện tiền đề DUY NHẤT chèn thẳng DB: một nhân viên ĐÃ CÓ MẬT KHẨU khi CHƯA có Admin. Trạng thái này chỉ do
// backfill của migration 5 tạo ra (mọi user cũ ⇒ EMPLOYEE, không Admin — ADR-138); không route công khai nào tạo
// được nó (thêm nhân viên cần Admin). Chèn đúng dòng mà backfill sinh: `users` + `company_members(EMPLOYEE)`.
// Mọi khẳng định "DB không đổi" đọc DB (chỉ SELECT) vì CLI chạy khi chưa có API / chưa có Admin để hỏi.
//
// Thứ tự ca CÓ Ý NGHĨA (một DB cho cả file): từ chối cấu hình (chưa có Admin) → nâng nhân viên sẵn có lên Admin →
// lần 2 / `--reissue-link` khi đã có Admin kích hoạt.

const PASSWORD = 'correct-horse-battery-staple-9';
const legacy = { email: `legacy-${randomUUID()}@sec.example`, fullName: 'Sec Legacy' };
let env: Record<string, string> = {};
let prisma: PrismaClient | undefined;
const db = () => {
  if (!prisma) throw new Error('DB của suite chưa sẵn sàng');
  return prisma;
};

const api = useApi({}, undefined, {
  beforeStart: async (ctx) => {
    env = ctx.env;
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: ctx.dbUrl }) });
    const passwordHash = await (await Argon2idPasswordHasher.create()).hash(PASSWORD);
    const user = await db().user.create({ data: { ...legacy, passwordHash } });
    await db().companyMember.create({
      data: { userId: user.id, role: 'EMPLOYEE', startDate: new Date('2026-01-05T00:00:00Z') },
    });
  },
});
const actors = new Actors(api);
afterAll(async () => {
  await prisma?.$disconnect();
});

const AREA = 'Mốc 3.5 — admin:bootstrap';
const run = (admin: { email: string; name?: string; company?: string }, args = ['--json']) =>
  runBootstrapRaw(bootstrapEnv(env, admin), args);
const snapshot = async () => ({
  users: await db().user.count(),
  admins: await db().companyMember.count({ where: { role: 'ADMIN' } }),
  companies: await db().company.count(),
  tokens: await db().accountActivationToken.count(),
});

describe('admin:bootstrap', () => {
  secCase(
    'SEC-HR-64',
    'thiếu từng env ⇒ thoát 2, không ghi gì; không TTY / --json ngoài APP_ENV=test ⇒ từ chối',
    AREA,
    async () => {
      const before = await snapshot();
      const ok = { email: `x-${randomUUID()}@sec.example`, name: 'Sec X', company: 'Sec Co' };
      for (const missing of ['BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_NAME', 'COMPANY_NAME']) {
        const vars = { ...bootstrapEnv(env, ok), [missing]: '' };
        const res = await runBootstrapRaw(vars, ['--json']);
        expect(res.code, `${missing}: ${res.stderr}`).toBe(2);
        expect(res.stderr).toContain(missing);
        expect(res.stdout.trim()).toBe('');
      }
      const notTest = await runBootstrapRaw({ ...bootstrapEnv(env, ok), APP_ENV: 'local' }, [
        '--json',
      ]);
      expect(notTest.code, notTest.stderr).toBe(2);
      expect(notTest.stderr).toContain('--json chỉ dùng được khi APP_ENV=test');
      for (const appEnv of ['test', 'local']) {
        // Không `--json` ⇒ bắt buộc tương tác; stdin `ignore` không phải TTY.
        const res = await runBootstrapRaw({ ...bootstrapEnv(env, ok), APP_ENV: appEnv }, []);
        expect(res.code, res.stderr).toBe(2);
        expect(res.stderr).toContain('Chỉ chạy tương tác (TTY)');
      }
      expect(await snapshot()).toEqual(before);
    },
  );

  secCase(
    'SEC-HR-64b',
    'email của nhân viên đã có mật khẩu (backfill) ⇒ nâng ADMIN, không token, mật khẩu giữ nguyên',
    AREA,
    async () => {
      const before = await snapshot();
      const res = await run({ email: legacy.email, name: 'Sec Legacy', company: 'Sec Co' });
      expect(res.code, res.stderr).toBe(0);
      const out = JSON.parse(res.stdout.trim().split('\n').at(-1) ?? '{}') as {
        userId?: string;
        activation?: unknown;
      };
      expect(out.activation).toBeNull();
      expect(await snapshot()).toEqual({
        users: before.users,
        admins: 1,
        companies: 1,
        tokens: before.tokens,
      });
      const login = await actors.json('POST', '/auth/login', undefined, {
        email: legacy.email,
        password: PASSWORD,
      });
      expect(login.status, login.text.slice(0, 200)).toBe(200);
      const token = (login.json as { data: { accessToken: string } }).data.accessToken;
      const me = await actors.json('GET', '/auth/me', token);
      expect(me.status).toBe(200);
      expect((me.json as { data: { company: unknown } }).data.company).toMatchObject({
        role: 'ADMIN',
        grants: [],
      });
      expect(out.userId).toBe((me.json as { data: { user: { id: string } } }).data.user.id);
    },
  );

  secCase(
    'SEC-HR-64c',
    'đã có Admin kích hoạt: chạy lần 2 (email khác) ⇒ thoát 1 "Đã có Admin", DB không đổi; --reissue-link ⇒ thoát 1',
    AREA,
    async () => {
      const before = await snapshot();
      const again = await run({ email: `second-${randomUUID()}@sec.example`, company: 'Khác' });
      expect(again.code, again.stderr).toBe(1);
      expect(again.stderr).toContain('Đã có Admin');
      expect(again.stdout.trim()).toBe('');
      const reissue = await run({ email: legacy.email }, ['--json', '--reissue-link']);
      expect(reissue.code, reissue.stderr).toBe(1);
      expect(reissue.stderr).toContain('Đã có Admin kích hoạt');
      expect(() => parseBootstrapOutput(reissue.stdout)).toThrow();
      expect(await snapshot()).toEqual(before);
      expect((await db().company.findFirst())?.name).toBe('Sec Co');
    },
  );
});
