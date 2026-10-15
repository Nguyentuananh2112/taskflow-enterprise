import type { IClock } from '../../../../core/domain';
import {
  InvalidCurrentPasswordError,
  UnauthorizedError,
  ValidationError,
} from '../../../../core/errors';
import type { IEventBus } from '../../../../core/events/event-bus';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { PasswordPolicy } from '../../domain/password-policy';
import type { SessionMeta } from '../../domain/refresh-token';
import {
  assertPasswordAllowed,
  bestEffort,
  toUserView,
  writeRevocationOrFail,
  type UserView,
} from '../auth-shared';
import type { IAuthRealtimeNotifier } from '../ports/collaborators.port';
import type { IPasswordHasher } from '../ports/password-hasher.port';
import type { IRefreshTokenRepository } from '../ports/refresh-token-repository.port';
import type { ISessionRevocationStore } from '../ports/session-revocation-store.port';
import type { IUserRepository } from '../ports/user-repository.port';
import type { IssuedSession, SessionIssuer } from '../session-issuer';

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  meta: SessionMeta;
}

export interface ChangePasswordDeps {
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  issuer: SessionIssuer;
  hasher: IPasswordHasher;
  policy: PasswordPolicy;
  store: ISessionRevocationStore;
  notifier: IAuthRealtimeNotifier;
  events: IEventBus;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}

/**
 * security.md 1.7: thu hồi MỌI refresh token + mọi access token (tv) + mọi socket; thiết bị hiện
 * tại nhận phiên mới để không bị đăng xuất.
 */
export class ChangePasswordUseCase {
  constructor(private readonly d: ChangePasswordDeps) {}

  async execute(input: ChangePasswordInput): Promise<{ session: IssuedSession; user: UserView }> {
    const current = await this.d.users.findById(input.userId);
    if (!current || current.isDeleted) throw new UnauthorizedError();
    if (!(await this.d.hasher.verify(current.passwordHash, input.currentPassword))) {
      // ASVS V16.3.1 (X9): dò mật khẩu hiện tại bằng access token trộm được là dấu hiệu tấn công.
      this.d.logger.warn(
        { userId: input.userId, ip: input.meta.ip },
        'auth.password_change_failed',
      );
      throw new InvalidCurrentPasswordError();
    }
    assertPasswordAllowed(this.d.policy, input.newPassword, current.email, 'newPassword');
    if (
      PasswordPolicy.normalize(input.newPassword) ===
      PasswordPolicy.normalize(input.currentPassword)
    ) {
      throw new ValidationError([
        {
          path: ['newPassword'],
          code: 'same_as_current',
          message: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
        },
      ]);
    }
    const newHash = await this.d.hasher.hash(input.newPassword); // NGOÀI transaction (PWD-07)

    return this.d.uow.run(async () => {
      const user = await this.d.users.findById(input.userId);
      if (!user || user.isDeleted) throw new UnauthorizedError();
      const now = this.d.clock.now();
      user.changePassword(newHash, now); // aggregate kiểm luật + phát event; KHÔNG lưu cả aggregate (ADR-104)
      // Có điều kiện password_hash = hash VỪA verify + tv + 1 trong cùng câu lệnh. Thua race (mật khẩu
      // vừa bị đổi ở request khác) ⇒ mật khẩu hiện tại không còn đúng ⇒ 400, không đổi gì.
      const tokenVersion = await this.d.users.changePassword({
        id: user.id,
        oldHash: current.passwordHash,
        newHash,
        at: now,
      });
      if (tokenVersion === null) throw new InvalidCurrentPasswordError();
      await this.d.refreshTokens.revokeAllForUser(user.id, 'PASSWORD_CHANGED', now);
      const session = await this.d.issuer.startNew({ id: user.id, tokenVersion }, input.meta);
      const { id } = user;
      // ADR-105: tv mới vào Valkey TRƯỚC commit; lỗi ⇒ 503 + rollback (mật khẩu cũ vẫn còn hiệu lực).
      await writeRevocationOrFail(() => this.d.store.setTokenVersion(id, tokenVersion));

      const events = user.pullDomainEvents();
      this.d.uow.afterCommit(async () => {
        this.d.logger.info({ userId: id, ip: input.meta.ip }, 'auth.password_changed');
        await bestEffort(this.d.logger, 'auth.session_cache_write_failed', { userId: id }, () =>
          this.d.store.setTokenVersion(id, tokenVersion),
        );
        await this.d.notifier.disconnectUser(id);
        await this.d.events.publish(events);
      });
      return { session, user: toUserView(user) };
    });
  }
}
