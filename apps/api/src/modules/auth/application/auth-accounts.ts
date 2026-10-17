import type { IClock, IIdGenerator } from '../../../core/domain';
import type { ILogger } from '../../../core/logging/logger';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import { Email } from '../domain/email';
import { User } from '../domain/user';
import { bestEffort, writeRevocationOrFail } from './auth-shared';
import type { IAuthRealtimeNotifier } from './ports/collaborators.port';
import type { IRefreshTokenRepository } from './ports/refresh-token-repository.port';
import type { ISessionRevocationStore } from './ports/session-revocation-store.port';
import type { IUserRepository } from './ports/user-repository.port';
import type { ActivationIssuer } from './use-cases/activation.use-cases';

/** Khớp cấu trúc port tài khoản của company (ADR-093) — wire ở composition root. */
export interface AuthAccounts {
  /** Email đã chuẩn hóa ở contracts; sai định dạng ⇒ `null`. */
  findByEmail(
    email: string,
  ): Promise<{ userId: string; fullName: string; deleted: boolean; hasPassword: boolean } | null>;
  findById(
    userId: string,
  ): Promise<{ userId: string; fullName: string; deleted: boolean; hasPassword: boolean } | null>;
  /** Tài khoản chờ kích hoạt (`password_hash` null). Email trùng ⇒ `EmailAlreadyExistsError` (unique). */
  createPending(input: { email: string; fullName: string }): Promise<{ userId: string }>;
  issueActivation(input: {
    userId: string;
    createdById: string | null;
    ttlMs: number;
  }): Promise<{ token: string; link: string; expiresAt: Date }>;
  /**
   * Hồ sơ tài khoản cho danh sách quản trị / nhân viên — MỘT truy vấn. Email là PII: chỉ trả ở route
   * `company:admin` / `hr:manage`, không log. `[]` ⇒ Map rỗng. User đã xóa vẫn có (`deleted: true`).
   */
  profiles(
    userIds: readonly string[],
  ): Promise<
    ReadonlyMap<string, { fullName: string; email: string; hasPassword: boolean; deleted: boolean }>
  >;
  /** Thu hồi mọi token kích hoạt còn sống (nghỉ việc). Trả số token. */
  revokeActivations(userId: string): Promise<number>;
  /** ADR-105: tv + 1, thu hồi refresh token, Valkey TRƯỚC commit (lỗi ⇒ 503 rollback), ngắt socket SAU commit. */
  revokeSessions(userId: string, reason: 'OFFBOARDED' | 'LOGOUT_ALL'): Promise<void>;
}

/** Tài khoản cho module company (Mốc 3.5) — mọi lệnh chạy TRONG transaction của bên gọi. */
export function createAuthAccounts(d: {
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  store: ISessionRevocationStore;
  notifier: IAuthRealtimeNotifier;
  activationIssuer: Pick<ActivationIssuer, 'issue' | 'revokeAll'>;
  ids: IIdGenerator;
  clock: IClock;
  uow: IUnitOfWork;
  logger: ILogger;
}): AuthAccounts {
  const { users, refreshTokens, store, notifier, activationIssuer, ids, clock, uow, logger } = d;
  const accountOf = (user: User | null) =>
    user
      ? {
          userId: user.id,
          fullName: user.fullName,
          deleted: user.isDeleted,
          hasPassword: user.passwordHash !== null,
        }
      : null;
  const accounts: AuthAccounts = {
    async findByEmail(raw) {
      let email: Email;
      try {
        email = Email.create(raw);
      } catch {
        return null;
      }
      return accountOf(await users.findByEmail(email));
    },
    findById: async (userId) => accountOf(await users.findById(userId)),
    async profiles(userIds) {
      if (userIds.length === 0) return new Map();
      const rows = await users.findManyByIds(userIds);
      return new Map(
        rows.map((u) => [
          u.id,
          {
            fullName: u.fullName,
            email: u.email.value,
            hasPassword: u.passwordHash !== null,
            deleted: u.isDeleted,
          },
        ]),
      );
    },
    async createPending(input) {
      const user = User.register({
        id: ids.next(),
        email: Email.create(input.email),
        passwordHash: null,
        fullName: input.fullName,
        now: clock.now(),
      });
      await users.add(user);
      return { userId: user.id };
    },
    issueActivation: (input) => activationIssuer.issue(input),
    revokeActivations: (userId) => activationIssuer.revokeAll(userId),
    async revokeSessions(userId, reason) {
      const now = clock.now();
      const tokenVersion = await users.bumpTokenVersion(userId, now);
      if (tokenVersion === null) return; // user đã xóa: không còn phiên nào hợp lệ
      await refreshTokens.revokeAllForUser(userId, reason, now);
      await writeRevocationOrFail(() => store.setTokenVersion(userId, tokenVersion));
      uow.afterCommit(async () => {
        logger.info({ userId, reason }, 'auth.sessions_revoked');
        await notifier.disconnectUser(userId);
        await bestEffort(logger, 'auth.session_cache_write_failed', { userId }, () =>
          store.setTokenVersion(userId, tokenVersion),
        );
      });
    },
  };
  return accounts;
}
