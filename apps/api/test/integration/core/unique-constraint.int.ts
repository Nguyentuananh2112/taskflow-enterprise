// Helper `uniqueConstraintOf` trên Postgres thật: cùng một vi phạm unique qua API model (P2002) và
// qua SQL thô (P2010 + 23505) phải ra đúng tên constraint — nguồn sự thật cho cấu trúc lỗi của Prisma 7.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { uniqueConstraintOf } from '../../../src/core/persistence/unique-constraint';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { createTestPrisma, seedMinimal, truncateAll } from '../db';

const prisma: PrismaClient = createTestPrisma();
beforeEach(async () => {
  await truncateAll(prisma);
  await seedMinimal(prisma); // users: mia@example.test; workspaces: w-one, w-two
});
afterAll(() => prisma.$disconnect());

const caught = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable('phải vi phạm unique'),
    (err: unknown) => err,
  );

describe('uniqueConstraintOf trên Postgres thật', () => {
  it('API model: email trùng ⇒ P2002 ⇒ users_email_key', async () => {
    const err = await caught(
      prisma.user.create({ data: { email: 'mia@example.test', fullName: 'X', passwordHash: 'x' } }),
    );
    expect((err as { code?: string }).code).toBe('P2002');
    expect(uniqueConstraintOf(err)).toBe('users_email_key');
  });

  it('SQL thô: slug trùng ⇒ P2010 + 23505 ⇒ workspaces_slug_key', async () => {
    const err = await caught(
      prisma.$executeRaw`UPDATE workspaces SET slug = 'w-one' WHERE slug = 'w-two'`,
    );
    expect((err as { code?: string }).code).toBe('P2010');
    expect(uniqueConstraintOf(err)).toBe('workspaces_slug_key');
  });

  it('SQL thô vi phạm CHECK (không phải unique) ⇒ null', async () => {
    const err = await caught(prisma.$executeRaw`UPDATE users SET email = 'Upper@Example.test'`);
    expect(uniqueConstraintOf(err)).toBeNull();
  });
});
