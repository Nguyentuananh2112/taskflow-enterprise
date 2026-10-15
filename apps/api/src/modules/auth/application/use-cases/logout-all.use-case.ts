import type { IClock } from '../../../../core/domain';
import { UnauthorizedError } from '../../../../core/errors';
import type { IEventBus } from '../../../../core/events/event-bus';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { bestEffort } from '../auth-shared';
import type { IAuthRealtimeNotifier } from '../ports/collaborators.port';
import type { IRefreshTokenRepository } from '../ports/refresh-token-repository.port';
import type { ISessionRevocationStore } from '../ports/session-revocation-store.port';
import type { IUserRepository } from '../ports/user-repository.port';

export interface LogoutAllDeps {
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  store: ISessionRevocationStore;
  notifier: IAuthRealtimeNotifier;
  events: IEventBus;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}

/** Đăng xuất mọi thiết bị (security.md 1.6, ADR-025). */
export class LogoutAllUseCase {
  constructor(private readonly d: LogoutAllDeps) {}

  async execute(input: { userId: string }): Promise<void> {
    await this.d.uow.run(async () => {
      const user = await this.d.users.findById(input.userId);
      if (!user) throw new UnauthorizedError();
      const now = this.d.clock.now();
      user.revokeAllSessions(now);
      await this.d.users.save(user);
      await this.d.refreshTokens.revokeAllForUser(user.id, 'LOGOUT_ALL', now);

      const events = user.pullDomainEvents();
      const { id, tokenVersion } = user;
      this.d.uow.afterCommit(async () => {
        // Ghi đè vô điều kiện SAU commit (writer) — reader dùng SET NX nên không ghi đè lại giá trị cũ.
        await bestEffort(this.d.logger, 'auth.session_cache_write_failed', { userId: id }, () =>
          this.d.store.setTokenVersion(id, tokenVersion),
        );
        await this.d.notifier.disconnectUser(id);
        await this.d.events.publish(events);
      });
    });
  }
}
