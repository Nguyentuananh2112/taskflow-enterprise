import { InMemoryActivationTokenRepository } from './in-memory-activation-token.repository';
import { InMemoryRefreshTokenRepository } from './in-memory-refresh-token.repository';
import { InMemorySessionRevocationStore } from './in-memory-session-revocation.store';
import { InMemoryPrivacyStore } from './in-memory-privacy.store';
import { InMemoryUserRepository } from './in-memory-user.repository';

/** Repository InMemory (dev/test). Prisma/Valkey của T-020 thay qua cùng interface. */
export function createInMemoryAuthRepositories() {
  const users = new InMemoryUserRepository();
  return {
    users,
    refreshTokens: new InMemoryRefreshTokenRepository(),
    sessions: new InMemorySessionRevocationStore(),
    activationTokens: new InMemoryActivationTokenRepository(),
    // T-075: user đã xóa ⇒ như Prisma (`deleted_at IS NULL`).
    privacy: new InMemoryPrivacyStore(async (id) => {
      const u = await users.findById(id);
      return !!u && u.toSnapshot().deletedAt === null;
    }),
  };
}
