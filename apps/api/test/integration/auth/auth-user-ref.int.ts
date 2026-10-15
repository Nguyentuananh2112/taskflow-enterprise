// IUserRefReader (cho module Task) trên Postgres thật (T-020).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaUserRefReader } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-user-ref.reader';
import { createAuthHarness } from '../../../src/modules/auth/testing/auth-harness';
import { prismaAuthBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

function harness() {
  const backend = prismaAuthBackend();
  return { h: createAuthHarness(backend), db: () => backend.uow.db() };
}

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

describe('PrismaUserRefReader (IUserRefReader cho module Task)', () => {
  it('trả tên kể cả user đã ẩn danh hóa; id lạ không có trong Map; danh sách rỗng ⇒ không query', async () => {
    const { h, db } = harness();
    const alice = await h.seedUser();
    await testPrisma().user.update({
      where: { id: alice.id },
      data: { fullName: 'Người dùng đã xóa', deletedAt: new Date() },
    });
    const reader = new PrismaUserRefReader(db);
    const refs = await reader.findRefs([
      alice.id,
      alice.id,
      '00000000-0000-4000-8000-0000000000aa',
    ]);
    expect([...refs.values()]).toEqual([{ id: alice.id, fullName: 'Người dùng đã xóa' }]);
    const noDb = new PrismaUserRefReader(() => {
      throw new Error('không được query khi ids rỗng');
    });
    expect((await noDb.findRefs([])).size).toBe(0);
  });
});
