// T-061a: lệnh Prisma mới của màn Quản trị trên Postgres thật — company_members (listAll / setGrants / demoteToEmployee),
// workspaces (archive / listForAdmin / findForAdmin), users (findManyByIds). Ràng buộc DB (CHECK grants/start_date) là
// chốt chặn cuối: lệnh có điều kiện không bao giờ để dòng vi phạm.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaUserRepository } from '../../src/modules/auth/infrastructure/persistence/prisma/prisma-user.repository';
import { PrismaCompanyMembers } from '../../src/modules/company/infrastructure/prisma/prisma-company';
import { PrismaWorkspaceQueries } from '../../src/modules/workspace/infrastructure/persistence/prisma/prisma-queries';
import { PrismaWorkspaceRepository } from '../../src/modules/workspace/infrastructure/persistence/prisma/prisma-repositories';
import { createTestPrisma, seedMinimal, truncateAll } from './db';

const prisma: PrismaClient = createTestPrisma();
const db = () => prisma;
let ctx: Awaited<ReturnType<typeof seedMinimal>>;
const AT = new Date('2026-11-15T03:00:00.000Z');

beforeEach(async () => {
  await truncateAll(prisma);
  ctx = await seedMinimal(prisma);
});
afterAll(() => prisma.$disconnect());

const user = (email: string, fullName: string) =>
  prisma.user.create({ data: { email, fullName, passwordHash: 'x' } });

describe('PrismaCompanyMembers — lệnh của /admin/access', () => {
  it('setGrants chỉ đổi EMPLOYEE (version + 1); demoteToEmployee chỉ đổi ADMIN (start_date mới); listAll đủ dòng, sắp theo userId', async () => {
    const members = new PrismaCompanyMembers(db);
    const admin = await user('admin@example.test', 'Admin');
    await prisma.companyMember.create({
      data: { userId: ctx.user.id, role: 'EMPLOYEE', startDate: new Date('2026-01-05T00:00:00Z') },
    });
    await prisma.companyMember.create({ data: { userId: admin.id, role: 'ADMIN' } });

    expect(await members.setGrants(admin.id, ['HR_MANAGE'], AT)).toBeNull(); // ADMIN không có grant
    expect(await members.setGrants(ctx.user.id, ['HR_MANAGE', 'PAYROLL_MANAGE'], AT)).toMatchObject(
      {
        grants: ['HR_MANAGE', 'PAYROLL_MANAGE'],
        version: 2,
      },
    );

    expect(
      await members.demoteToEmployee(ctx.user.id, { startDate: '2026-11-16', grants: [], at: AT }),
    ).toBeNull(); // không phải ADMIN
    expect(
      await members.demoteToEmployee(admin.id, {
        startDate: '2026-11-16',
        grants: ['PAYROLL_MANAGE'],
        at: AT,
      }),
    ).toMatchObject({
      role: 'EMPLOYEE',
      startDate: '2026-11-16',
      grants: ['PAYROLL_MANAGE'],
      version: 2,
    });

    const all = await members.listAll();
    expect(all.map((m) => m.userId)).toEqual([ctx.user.id, admin.id].sort());
    expect(all.every((m) => m.role === 'EMPLOYEE')).toBe(true);
  });
});

describe('Prisma workspace — lệnh của /admin/workspaces', () => {
  it('archive có điều kiện (đã xóa mềm / đã lưu trữ ⇒ false); listForAdmin / findForAdmin trả thành viên kèm tên, KHÔNG dự án', async () => {
    const repo = new PrismaWorkspaceRepository(db);
    const queries = new PrismaWorkspaceQueries(db);
    const other = await user('pam@example.test', 'Pam');
    await prisma.workspaceMember.create({
      data: { workspaceId: ctx.w1.id, userId: other.id, role: 'PM' },
    });

    expect(await repo.archive(ctx.w2.id, AT)).toBe(true);
    expect(await repo.archive(ctx.w2.id, AT)).toBe(false);
    // Xóa mềm hợp lệ: deleted_at + purge_at cùng khác NULL (workspaces_soft_delete_chk).
    await prisma.workspace.update({
      where: { id: ctx.w1.id },
      data: { deletedAt: AT, purgeAt: new Date(AT.getTime() + 30 * 86_400_000) },
    });
    expect(await repo.archive(ctx.w1.id, AT)).toBe(false);
    expect((await repo.findById(ctx.w2.id))?.archivedAt).toEqual(AT);

    const rows = await queries.listForAdmin();
    expect(rows.map((r) => [r.name, r.deletedAt !== null, r.archivedAt !== null])).toEqual([
      ['W1', true, false],
      ['W2', false, true],
    ]);
    expect(rows[0]!.members).toEqual([{ userId: other.id, fullName: 'Pam', role: 'PM' }]);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'archivedAt',
      'deletedAt',
      'id',
      'members',
      'name',
    ]);
    expect(await queries.findForAdmin(ctx.w2.id)).toMatchObject({ id: ctx.w2.id, members: [] });
    expect(await queries.findForAdmin('0199e5a2-0000-7000-8000-00000000dead')).toBeNull();
  });
});

describe('PrismaUserRepository.findManyByIds', () => {
  it('một truy vấn `id in`: đúng id có thật; [] ⇒ [] (không phải mọi dòng)', async () => {
    const users = new PrismaUserRepository(db);
    const other = await user('other@example.test', 'Other');
    const found = await users.findManyByIds([
      other.id,
      ctx.user.id,
      '0199e5a2-0000-7000-8000-00000000dead',
    ]);
    expect(found.map((u) => u.id).sort()).toEqual([other.id, ctx.user.id].sort());
    expect(await users.findManyByIds([])).toEqual([]);
  });
});
