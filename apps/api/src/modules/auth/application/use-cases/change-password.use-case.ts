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
import { assertPasswordAllowed, bestEffort, toUserView, type UserView } from '../auth-shared';
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
      // Đọc lại trong transaction để không ghi đè thay đổi đồng thời.
      const user = await this.d.users.findById(input.userId);
      if (!user || user.isDeleted) throw new UnauthorizedError();
      const now = this.d.clock.now();
      user.changePassword(newHash, now);
      await this.d.users.save(user);
      await this.d.refreshTokens.revokeAllForUser(user.id, 'PASSWORD_CHANGED', now);
      const session = await this.d.issuer.startNew(user, input.meta);

      const events = user.pullDomainEvents();
      const { id, tokenVersion } = user;
      this.d.uow.afterCommit(async () => {
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
