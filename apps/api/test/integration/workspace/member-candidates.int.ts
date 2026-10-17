// member-candidates tầng I (company-level ADR-134, SEC-HR-37): SQL thật của `PrismaMemberCandidates` — đọc
// company_members JOIN users, loại người có lịch nghỉ / đã rời / tài khoản xóa mềm / đã ở ws, ILIKE với `%`/`_`/`\`
// theo nghĩa đen, sắp (tên, id), LIMIT.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaMemberCandidates } from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-member-candidates';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

let ws: string;
const dir = new PrismaMemberCandidates(() => testPrisma());
const search = (q: string, limit = 20) => dir.search({ workspaceId: ws, q, limit });
const ids: Record<string, string> = {};

beforeEach(async () => {
  await resetDatabase();
  const prisma = testPrisma();
  const make = async (key: string, fullName: string, extra: { deleted?: boolean } = {}) => {
    const u = await prisma.user.create({
      data: {
        email: `${key}@example.test`,
        fullName,
        passwordHash: key === 'nina' ? null : 'x',
        deletedAt: extra.deleted ? new Date() : null,
      },
    });
    ids[key] = u.id;
    return u.id;
  };
  const start = new Date('2026-10-01T00:00:00.000Z');
  for (const [key, name] of [
    ['olivia', 'Olivia'],
    ['pam', 'Pam'],
    ['mia', 'Mia'],
    ['nina', 'Nina'],
    ['lit', 'Lý 100%_x\\'],
    ['ann1', 'Ann'],
    ['ann2', 'Ann'],
    ['del', 'Deleted'],
  ] as const) {
    const id = await make(key, name, { deleted: key === 'del' });
    await prisma.companyMember.create({
      data:
        key === 'olivia'
          ? { userId: id, role: 'ADMIN' }
          : { userId: id, role: 'EMPLOYEE', startDate: start },
    });
  }
  await make('quinn', 'Quinn'); // đã rời: không có dòng company_members
  await prisma.companyMember.update({
    where: { userId: ids.mia! },
    data: {
      offboardLastDay: new Date('2026-11-30T00:00:00.000Z'),
      offboardAccessUntil: new Date('2026-11-30T23:00:00.000Z'),
      offboardScheduledById: ids.olivia!,
    },
  });
  const w = await prisma.workspace.create({ data: { name: 'A', slug: 'a' } });
  const other = await prisma.workspace.create({ data: { name: 'B', slug: 'b' } });
  ws = w.id;
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws, userId: ids.pam!, role: 'OWNER' },
      { workspaceId: other.id, userId: ids.nina!, role: 'MEMBER' },
    ],
  });
});
afterAll(disconnectTestPrisma);

describe('PrismaMemberCandidates', () => {
  it('Admin + nhân viên (kể cả chờ kích hoạt) chưa ở ws; không lịch nghỉ / đã rời / xóa mềm; sắp (tên, id)', async () => {
    const rows = await search('EXAMPLE.TEST');
    const [first, second] = [ids.ann1!, ids.ann2!].sort();
    expect(rows.map((r) => r.id)).toEqual([first, second, ids.lit, ids.nina, ids.olivia]);
    expect(rows[0]).toEqual({ id: first, fullName: 'Ann', email: expect.any(String) as string });
  });

  it('%/_/\\ theo nghĩa đen; LIMIT', async () => {
    expect((await search('0%_x\\')).map((r) => r.id)).toEqual([ids.lit]);
    expect((await search('%')).map((r) => r.id)).toEqual([ids.lit]);
    expect((await search('_')).map((r) => r.id)).toEqual([ids.lit]);
    expect(await search('ann', 1)).toHaveLength(1);
  });
});
