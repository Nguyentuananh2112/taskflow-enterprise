import type { IClock } from '../../../../core/domain';
import { RefreshInProgressError, RefreshTokenInvalidError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { RefreshToken, SessionMeta } from '../../domain/refresh-token';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  bestEffort,
  toUserView,
  writeRevocationOrFail,
  type UserView,
} from '../auth-shared';
import type { IAuthRealtimeNotifier } from '../ports/collaborators.port';
import type { IRefreshTokenFactory } from '../ports/refresh-token-factory.port';
import type { IRefreshTokenRepository } from '../ports/refresh-token-repository.port';
import type { ISessionRevocationStore } from '../ports/session-revocation-store.port';
import type { IUserRepository } from '../ports/user-repository.port';
import type { IssuedSession, SessionIssuer } from '../session-issuer';

export interface RefreshSessionInput {
  /** Giá trị cookie — `undefined` khi không có cookie. */
  refreshToken: string | undefined;
  meta: SessionMeta;
}

export interface RefreshSessionDeps {
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  refreshTokenFactory: IRefreshTokenFactory;
  issuer: SessionIssuer;
  store: ISessionRevocationStore;
  notifier: IAuthRealtimeNotifier;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}

/**
 * Xoay refresh token + phát hiện reuse (security.md 1.4, ADR-024). Mọi thất bại trả
 * `REFRESH_TOKEN_INVALID` chung — không tiết lộ đã phát hiện reuse. Presentation xóa cookie.
 */
export class RefreshSessionUseCase {
  constructor(private readonly d: RefreshSessionDeps) {}

  async execute(input: RefreshSessionInput): Promise<{ session: IssuedSession; user: UserView }> {
    if (!input.refreshToken) throw new RefreshTokenInvalidError();
    const token = await this.d.refreshTokens.findByHash(
      this.d.refreshTokenFactory.hash(input.refreshToken),
    );
    if (!token) throw new RefreshTokenInvalidError();

    const now = this.d.clock.now();
    switch (token.assess(now)) {
      case 'superseded':
        throw new RefreshInProgressError();
      case 'reused':
        await this.#revokeReusedFamily(token, now);
        throw new RefreshTokenInvalidError();
      case 'expired':
      case 'revoked':
        throw new RefreshTokenInvalidError();
      case 'valid':
        break;
    }

    return this.d.uow.run(async () => {
      const user = await this.d.users.findById(token.userId);
      if (!user || user.isDeleted) throw new RefreshTokenInvalidError();
      // Thêm token mới TRƯỚC (FK replaced_by_id), rồi xoay có điều kiện; thua race ⇒ rollback cả hai.
      const { session, tokenId } = await this.d.issuer.continueFamily(user, token, input.meta);
      if (!(await this.d.refreshTokens.markRotated(token.id, tokenId, now))) {
        throw new RefreshInProgressError();
      }
      return { session, user: toUserView(user) };
    });
  }

  async #revokeReusedFamily(token: RefreshToken, now: Date): Promise<void> {
    const { familyId, userId } = token;
    await this.d.uow.run(async () => {
      await this.d.refreshTokens.revokeFamily(familyId, 'REUSE_DETECTED', now);
      // ADR-105: chặn access token của family bị lộ TRƯỚC commit; lỗi ⇒ 503 + rollback.
      await writeRevocationOrFail(() =>
        this.d.store.revokeSession(familyId, ACCESS_TOKEN_TTL_SECONDS),
      );
      this.d.uow.afterCommit(async () => {
        this.d.logger.warn({ userId, familyId }, 'refresh.reuse_detected');
        await bestEffort(this.d.logger, 'auth.session_cache_write_failed', { familyId }, () =>
          this.d.store.revokeSession(familyId, ACCESS_TOKEN_TTL_SECONDS),
        );
        await this.d.notifier.disconnectSession(familyId);
      });
    });
  }
}
