// IReadSnapshot trên Postgres thật (ADR-130; B review T-057; F XL-07): REPEATABLE READ READ ONLY bao trọn mọi lô đọc —
// lệnh ghi xen giữa hai lô KHÔNG lọt vào; ghi trong snapshot ⇒ Postgres từ chối (25006); lồng với uow.run theo cả hai
// chiều ⇒ lỗi lập trình; repository đọc qua `uow.db()` tự dùng transaction snapshot.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma } from '../../../src/generated/prisma/client';
import { ReadSnapshotNestingError } from '../../../src/core/persistence/read-snapshot';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const uow = new RecordingUnitOfWork();
const db = (): Prisma.TransactionClient => uow.inner.db();
const user = (n: number) => ({
  email: `snap-${String(n)}@example.test`,
  fullName: `Snap ${String(n)}`,
  passwordHash: 'x',
});

beforeEach(async () => {
  await resetDatabase();
  await testPrisma().user.createMany({ data: [1, 2, 3].map(user) });
});
afterAll(disconnectTestPrisma);

describe('IReadSnapshot (Prisma)', () => {
  it('XL-07: ghi (bằng kết nối khác) giữa hai lô đọc KHÔNG lọt vào snapshot; ngoài snapshot thì thấy', async () => {
    const seen = await uow.inner.snapshot.run(
      async () => {
        const first = await db().user.count();
        await testPrisma().user.create({ data: user(4) }); // kết nối khác, commit ngay
        const second = await db().user.count();
        return { first, second };
      },
      { timeoutMs: 20_000 },
    );
    expect(seen).toEqual({ first: 3, second: 3 });
    expect(await testPrisma().user.count()).toBe(4);
  });

  it('ghi trong snapshot ⇒ Postgres từ chối (read-only transaction), không có dòng mới', async () => {
    await expect(
      uow.inner.snapshot.run(() => db().user.create({ data: user(9) }), { timeoutMs: 20_000 }),
    ).rejects.toThrow(/read-only transaction|25006/);
    expect(await testPrisma().user.count()).toBe(3);
  });

  it('lồng: snapshot trong uow.run ⇒ lỗi; uow.run trong snapshot ⇒ lỗi; timeout ngoài 1..120 000 ⇒ lỗi', async () => {
    await expect(
      uow.run(() => uow.inner.snapshot.run(() => Promise.resolve(1), { timeoutMs: 1_000 })),
    ).rejects.toBeInstanceOf(ReadSnapshotNestingError);
    await expect(
      uow.inner.snapshot.run(() => uow.inner.run(() => Promise.resolve(1)), { timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(ReadSnapshotNestingError);
    for (const timeoutMs of [0, 120_001, 1.5]) {
      await expect(
        uow.inner.snapshot.run(() => Promise.resolve(1), { timeoutMs }),
      ).rejects.toBeInstanceOf(RangeError);
    }
  });
});
