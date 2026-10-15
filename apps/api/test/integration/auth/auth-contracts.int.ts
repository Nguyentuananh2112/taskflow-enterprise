// Contract chung (src/modules/auth/testing/persistence-contracts.ts) chạy cho bản Prisma + Valkey thật —
// cùng bộ khẳng định với bản InMemory (QA F, T-017 §B.4; T-020).
import { afterAll } from 'vitest';

import { ValkeySessionRevocationStore } from '../../../src/modules/auth/infrastructure/cache/valkey-session-revocation.store';
import { PrismaRefreshTokenRepository } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-refresh-token.repository';
import { PrismaUserRepository } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-user.repository';
import {
  describeRefreshTokenRepositoryContract,
  describeSessionStoreContract,
  describeUserRepositoryContract,
  type AuthPersistence,
} from '../../../src/modules/auth/testing/contracts';
import {
  connectTestValkey,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

async function prisma(): Promise<AuthPersistence> {
  await resetDatabase();
  const db = () => testPrisma();
  return {
    users: new PrismaUserRepository(db),
    refreshTokens: new PrismaRefreshTokenRepository(db),
    markDeleted: async (userId) => {
      await testPrisma().user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    },
  };
}

let valkey: Awaited<ReturnType<typeof connectTestValkey>> | undefined;
afterAll(async () => {
  await valkey?.quit();
  await disconnectTestPrisma();
});

describeUserRepositoryContract('Prisma', prisma);
describeRefreshTokenRepositoryContract('Prisma', prisma);
describeSessionStoreContract('Valkey', async () => {
  valkey ??= await connectTestValkey();
  return new ValkeySessionRevocationStore(valkey);
});
