// T-068 trên Postgres thật: cột `users.avatar_version` (CHECK), repo avatar (lockAvatar FOR UPDATE — hai lần đặt ảnh
// đồng thời không mất version), PrismaAvatarDirectory ("thuộc công ty" = còn dòng company_members + chưa xóa;
// left_at lấy lần rời gần nhất; clearDeparted chỉ người VẪN không thuộc công ty).
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaAvatarDirectory } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-avatar-directory';
import { prismaAuthBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

const HASH = '$argon2id$v=19$m=47104,t=1,p=1$c2VlZC1zYWx0LXRlc3Q$ZmFrZS1oYXNoLWZvci10ZXN0LW9ubHk';
const AT = new Date('2026-11-01T00:00:00Z');

async function seed(
  name: string,
  o: { version?: number; member?: boolean; deleted?: boolean } = {},
): Promise<string> {
  const prisma = testPrisma();
  const user = await prisma.user.create({
    data: {
      email: `${name}-${randomUUID()}@example.com`,
      fullName: name,
      passwordHash: HASH,
      avatarVersion: o.version ?? null,
      deletedAt: o.deleted ? AT : null,
    },
  });
  if (o.member ?? true) {
    await prisma.companyMember.create({
      data: { userId: user.id, role: 'EMPLOYEE', startDate: new Date('2026-01-05T00:00:00Z') },
    });
  }
  return user.id;
}

async function departed(userId: string, leftAt: Date) {
  await testPrisma().companyMemberDeparture.create({
    data: {
      id: randomUUID(),
      userId,
      role: 'EMPLOYEE',
      firstDay: new Date('2026-01-05T00:00:00Z'),
      lastDay: leftAt,
      leftAt,
      reason: 'OFFBOARDED',
    },
  });
}

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

describe('users.avatar_version + repo avatar', () => {
  it('CHECK: 0 / âm ⇒ DB từ chối; NULL ok', async () => {
    const id = await seed('Mia');
    await expect(
      testPrisma().user.update({ where: { id }, data: { avatarVersion: 0 } }),
    ).rejects.toThrow(/users_avatar_version_positive_chk/);
    await expect(
      testPrisma().user.update({ where: { id }, data: { avatarVersion: -1 } }),
    ).rejects.toThrow(/users_avatar_version_positive_chk/);
  });

  it('setAvatarVersion / avatarVersions: user đã xóa ⇒ không ghi, không trả; NULL ⇒ không có trong Map', async () => {
    const { users, uow } = prismaAuthBackend();
    const mia = await seed('Mia');
    const gone = await seed('Gone', { version: 2, deleted: true });
    const none = await seed('None');
    expect(await uow.run(() => users.setAvatarVersion({ id: mia, version: 4, at: AT }))).toBe(true);
    expect(await uow.run(() => users.setAvatarVersion({ id: gone, version: 5, at: AT }))).toBe(
      false,
    );
    expect([...(await users.avatarVersions([mia, gone, none, mia]))]).toEqual([[mia, 4]]);
    expect(await uow.run(() => users.lockAvatar(gone))).toBeNull();
  });

  it('CC (R46): hai giao dịch lock → +1 đồng thời ⇒ tuần tự hóa, version cuối = 2 (không mất lần đặt)', async () => {
    const { users, uow } = prismaAuthBackend();
    const mia = await seed('Mia');
    const bump = () =>
      uow.run(async () => {
        const locked = await users.lockAvatar(mia);
        await new Promise((r) => setTimeout(r, 50)); // giữ khóa để giao dịch kia phải chờ
        const next = (locked?.version ?? 0) + 1;
        await users.setAvatarVersion({ id: mia, version: next, at: AT });
        return next;
      });
    const got = await Promise.all([bump(), bump()]);
    expect(got.sort()).toEqual([1, 2]);
    expect((await users.avatarVersions([mia])).get(mia)).toBe(2);
  });
});

describe('PrismaAvatarDirectory', () => {
  const directory = () => new PrismaAvatarDirectory(() => prismaAuthBackend().uow.db());

  it('activeVersions: chỉ người còn company_members, chưa xóa, có ảnh; [] ⇒ không query', async () => {
    const mia = await seed('Mia', { version: 3 });
    const left = await seed('Left', { version: 1, member: false });
    const gone = await seed('Gone', { version: 1, deleted: true });
    const none = await seed('None');
    expect([...(await directory().activeVersions([mia, left, gone, none]))]).toEqual([[mia, 3]]);
    const noDb = new PrismaAvatarDirectory(() => {
      throw new Error('không được query khi ids rỗng');
    });
    expect((await noDb.activeVersions([])).size).toBe(0);
  });

  it('sweepStates: member / leftAt = lần rời GẦN NHẤT; clearDeparted bỏ qua người đã được nhận lại', async () => {
    const mia = await seed('Mia', { version: 3 });
    const left = await seed('Left', { version: 2, member: false });
    const back = await seed('Back', { version: 1 });
    await departed(left, new Date('2026-08-01T00:00:00Z'));
    await departed(left, new Date('2026-09-15T00:00:00Z'));
    await departed(back, new Date('2026-07-01T00:00:00Z')); // rời rồi được nhận lại ⇒ member
    const states = await directory().sweepStates([mia, left, back]);
    expect(states.get(mia)).toEqual({ version: 3, member: true, leftAt: null });
    expect(states.get(left)).toEqual({
      version: 2,
      member: false,
      leftAt: new Date('2026-09-15T00:00:00Z'),
    });
    expect(states.get(back)?.member).toBe(true);

    expect(await directory().clearDeparted([left, back, mia])).toBe(1);
    const rows = await testPrisma().user.findMany({
      where: { id: { in: [mia, left, back] } },
      select: { id: true, avatarVersion: true },
    });
    expect(new Map(rows.map((r) => [r.id, r.avatarVersion]))).toEqual(
      new Map([
        [mia, 3],
        [left, null],
        [back, 1],
      ]),
    );
  });
});
