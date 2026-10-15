import {
  FakeClock,
  FakeUnitOfWork,
  SequentialIdGenerator,
  SpyEventBus,
  SpyLogger,
  createSpy,
} from '../../../../test/support';
import { ACCESS_TOKEN_TTL_SECONDS } from '../application/auth-shared';
import type { IAuthRealtimeNotifier } from '../application/ports/collaborators.port';
import { SessionIssuer } from '../application/session-issuer';
import { Email } from '../domain/email';
import { PasswordPolicy } from '../domain/password-policy';
import { User } from '../domain/user';
import { InMemoryRefreshTokenRepository } from '../infrastructure/persistence/in-memory/in-memory-refresh-token.repository';
import { InMemorySessionRevocationStore } from '../infrastructure/persistence/in-memory/in-memory-session-revocation.store';
import { InMemoryUserRepository } from '../infrastructure/persistence/in-memory/in-memory-user.repository';
import { CryptoRefreshTokenFactory } from '../infrastructure/security/crypto-refresh-token-factory';
import { JoseAccessTokenService } from '../infrastructure/security/jose-access-token-service';
import { FakeMembershipReader, FakePasswordHasher, FakeWorkspaceProvisioner } from './fakes';

export const NOW = '2026-11-01T00:00:00.000Z';
export const META = { userAgent: 'vitest', ip: '203.0.113.7' };
export const PASSWORD = 'correct-horse-12';
export const TEST_JWT_SECRET = 'test-only-jwt-secret-0123456789abcdef';

/**
 * Lắp toàn bộ phụ thuộc của module auth cho test U (test-spec §0.2): InMemory repo đăng ký với
 * FakeUnitOfWork (rollback thật), JWT thật với FakeClock, refresh token thật.
 */
export function createAuthHarness() {
  const clock = new FakeClock(NOW);
  const ids = new SequentialIdGenerator();
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const uow = new FakeUnitOfWork(users, refreshTokens);
  const store = new InMemorySessionRevocationStore();
  const refreshTokenFactory = new CryptoRefreshTokenFactory();
  const accessTokens = new JoseAccessTokenService(
    {
      secret: TEST_JWT_SECRET,
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
      ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    },
    clock,
  );
  const hasher = new FakePasswordHasher(uow);
  const policy = new PasswordPolicy(new Set(['password123456']));
  const provisioner = new FakeWorkspaceProvisioner(uow);
  const memberships = new FakeMembershipReader();
  const notifier = createSpy<IAuthRealtimeNotifier>(uow);
  const events = new SpyEventBus();
  const logger = new SpyLogger();
  const issuer = new SessionIssuer({
    refreshTokens,
    refreshTokenFactory,
    accessTokens,
    ids,
    clock,
  });

  const h = {
    clock,
    ids,
    users,
    refreshTokens,
    uow,
    store,
    refreshTokenFactory,
    accessTokens,
    hasher,
    policy,
    provisioner,
    memberships,
    notifier,
    events,
    logger,
    issuer,

    /** Seed user trực tiếp vào repo (không qua use case). */
    async seedUser(
      email = 'alice@example.com',
      over: { tokenVersion?: number; deleted?: boolean } = {},
    ) {
      const user = User.register({
        id: ids.next(),
        email: Email.create(email),
        passwordHash: `h:${PASSWORD}`,
        fullName: 'Alice Nguyen',
        now: clock.now(),
      });
      const snap = { ...user.toSnapshot(), tokenVersion: over.tokenVersion ?? 0 };
      if (over.deleted) snap.deletedAt = clock.now();
      await users.add(User.reconstitute(snap));
      return User.reconstitute(snap);
    },

    /** Seed một phiên (family mới) cho user, trả token thô + familyId. */
    async seedSession(user: User) {
      return uow.run(() => issuer.startNew(user, META));
    },
  };
  return h;
}

export type AuthHarness = ReturnType<typeof createAuthHarness>;

/** Access token đúng định dạng nhưng ký bằng secret KHÁC (cùng iss/aud) — ca tấn công MW-02. */
export async function signWithForeignSecret(h: AuthHarness): Promise<string> {
  const forger = new JoseAccessTokenService(
    {
      secret: 'test-only-some-other-secret-0123456789',
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
    },
    h.clock,
  );
  return (await forger.sign({ sub: 'u', tv: 0, sid: 's' })).token;
}
