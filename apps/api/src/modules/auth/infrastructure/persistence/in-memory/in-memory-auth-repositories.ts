import { InMemoryActivationTokenRepository } from './in-memory-activation-token.repository';
import { InMemoryRefreshTokenRepository } from './in-memory-refresh-token.repository';
import { InMemorySessionRevocationStore } from './in-memory-session-revocation.store';
import { InMemoryUserRepository } from './in-memory-user.repository';

/** Repository InMemory (dev/test). Prisma/Valkey của T-020 thay qua cùng interface. */
export function createInMemoryAuthRepositories() {
  return {
    users: new InMemoryUserRepository(),
    refreshTokens: new InMemoryRefreshTokenRepository(),
    sessions: new InMemorySessionRevocationStore(),
    activationTokens: new InMemoryActivationTokenRepository(),
  };
}
