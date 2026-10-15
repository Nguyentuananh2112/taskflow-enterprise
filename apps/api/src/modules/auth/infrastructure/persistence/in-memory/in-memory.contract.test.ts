// Contract chung (persistence-contracts.ts) chạy cho bản InMemory — cùng bộ chạy cho Prisma/Valkey ở
// test/integration/auth/auth-contracts.int.ts. InMemory là runtime thật của chế độ bộ nhớ (QA B.4).
import { InMemoryRefreshTokenRepository } from './in-memory-refresh-token.repository';
import { InMemorySessionRevocationStore } from './in-memory-session-revocation.store';
import { InMemoryUserRepository } from './in-memory-user.repository';
import {
  describeRefreshTokenRepositoryContract,
  describeSessionStoreContract,
  describeUserRepositoryContract,
  type AuthPersistence,
} from '../../../testing/contracts';

function inMemory(): Promise<AuthPersistence> {
  const users = new InMemoryUserRepository();
  return Promise.resolve({
    users,
    refreshTokens: new InMemoryRefreshTokenRepository(),
    // Fixture ngoài port (như `UPDATE users SET deleted_at` ở bản Prisma): ghi đè snapshot lưu trữ.
    markDeleted: (userId) => {
      users.restore(
        new Map(
          users.rows().map((r) => [r.id, r.id === userId ? { ...r, deletedAt: new Date() } : r]),
        ),
      );
      return Promise.resolve();
    },
  });
}

describeUserRepositoryContract('InMemory', inMemory);
describeRefreshTokenRepositoryContract('InMemory', inMemory);
describeSessionStoreContract('InMemory', () =>
  Promise.resolve(new InMemorySessionRevocationStore()),
);
