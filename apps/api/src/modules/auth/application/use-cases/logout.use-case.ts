import type { IClock } from '../../../../core/domain';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { SESSION_REVOCATION_TTL_SECONDS, bestEffort, writeRevocationOrFail } from '../auth-shared';
import type { IAuthRealtimeNotifier } from '../ports/collaborators.port';
import type { IRefreshTokenFactory } from '../ports/refresh-token-factory.port';
import type { IRefreshTokenRepository } from '../ports/refresh-token-repository.port';
import type { ISessionRevocationStore } from '../ports/session-revocation-store.port';

export interface LogoutDeps {
  refreshTokens: IRefreshTokenRepository;
  refreshTokenFactory: IRefreshTokenFactory;
  store: ISessionRevocationStore;
  notifier: IAuthRealtimeNotifier;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}

/**
 * Đăng xuất 1 thiết bị (security.md 1.5): luôn thành công (idempotent) — không lộ token có tồn
 * tại hay không. Thu hồi cả family; access token của phiên chết ngay nhờ `sid-revoked`.
 */
export class LogoutUseCase {
  constructor(private readonly d: LogoutDeps) {}

  async execute(input: { refreshToken: string | undefined }): Promise<void> {
    if (!input.refreshToken) return;
    const token = await this.d.refreshTokens.findByHash(
      this.d.refreshTokenFactory.hash(input.refreshToken),
    );
    if (!token) return;
    const { familyId } = token;

    await this.d.uow.run(async () => {
      await this.d.refreshTokens.revokeFamily(familyId, 'LOGOUT', this.d.clock.now());
      // ADR-105: sid-revoked vào Valkey TRƯỚC commit; lỗi ⇒ 503 + rollback (không "đăng xuất nửa vời").
      await writeRevocationOrFail(() =>
        this.d.store.revokeSession(familyId, SESSION_REVOCATION_TTL_SECONDS),
      );
      this.d.uow.afterCommit(async () => {
        await bestEffort(this.d.logger, 'auth.session_cache_write_failed', { familyId }, () =>
          this.d.store.revokeSession(familyId, SESSION_REVOCATION_TTL_SECONDS),
        );
        await this.d.notifier.disconnectSession(familyId);
      });
    });
  }
}
