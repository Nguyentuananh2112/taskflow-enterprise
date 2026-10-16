import type { IClock } from '../../../../core/domain';
import { RefreshInProgressError, RefreshTokenInvalidError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { RefreshToken, SessionMeta } from '../../domain/refresh-token';
import {
  SESSION_REVOCATION_TTL_SECONDS,
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
        await this.#revokeReusedFamily(token, now, input.meta);
        throw new RefreshTokenInvalidError();
      case 'expired':
      case 'revoked':
        throw new RefreshTokenInvalidError();
      case 'valid':
        break;
    }

    return this.d.uow.run(async () => {
      // X4 (T-032): khóa chia sẻ dòng user TRƯỚC khi tạo token mới — logout-all / đổi mật khẩu
      // đồng thời (UPDATE users) phải chờ ta commit rồi mới `revokeAllForUser` ⇒ thấy token mới.
      // Họ đi trước ⇒ ta chờ, đọc `tv` mới, và `markRotated` thua (token cũ đã bị thu hồi).
      const tokenVersion = await this.d.users.lockTokenVersion(token.userId);
      const user = tokenVersion === null ? null : await this.d.users.findById(token.userId);
      if (tokenVersion === null || !user || user.isDeleted) throw new RefreshTokenInvalidError();
      // Thêm token mới TRƯỚC (FK replaced_by_id), rồi xoay có điều kiện; thua race ⇒ rollback cả hai.
      const { session, tokenId } = await this.d.issuer.continueFamily(
        { id: user.id, tokenVersion },
        token,
        input.meta,
      );
      if (!(await this.d.refreshTokens.markRotated(token.id, tokenId, now))) {
        throw new RefreshInProgressError();
      }
      return { session, user: toUserView(user) };
    });
  }

  async #revokeReusedFamily(token: RefreshToken, now: Date, meta: SessionMeta): Promise<void> {
    const { familyId, userId } = token;
    await this.d.uow.run(async () => {
      // 0 token còn sống ⇒ family đã chết vì lý do khác (LOGOUT / LOGOUT_ALL / PASSWORD_CHANGED / reuse trước đó):
      // thường là client gửi lại cookie cũ sau khi mất response xoay — KHÔNG báo động reuse (G1 auth L1, nhiễu X9).
      const revoked = await this.d.refreshTokens.revokeFamily(familyId, 'REUSE_DETECTED', now);
      // ADR-105: chặn access token của family bị lộ TRƯỚC commit; lỗi ⇒ 503 + rollback.
      await writeRevocationOrFail(() =>
        this.d.store.revokeSession(familyId, SESSION_REVOCATION_TTL_SECONDS),
      );
      this.d.uow.afterCommit(async () => {
        const event = { userId, familyId, ip: meta.ip, userAgent: meta.userAgent };
        if (revoked > 0) this.d.logger.warn(event, 'refresh.reuse_detected');
        else this.d.logger.info(event, 'refresh.replay_after_revocation');
        await bestEffort(this.d.logger, 'auth.session_cache_write_failed', { familyId }, () =>
          this.d.store.revokeSession(familyId, SESSION_REVOCATION_TTL_SECONDS),
        );
        await this.d.notifier.disconnectSession(familyId);
      });
    });
  }
}
