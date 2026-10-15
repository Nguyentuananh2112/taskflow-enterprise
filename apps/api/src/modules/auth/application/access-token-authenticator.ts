import {
  ServiceUnavailableError,
  TokenExpiredError,
  UnauthorizedError,
} from '../../../core/errors';
import type { ILogger } from '../../../core/logging/logger';
import { bestEffort } from './auth-shared';
import type { IAccessTokenService } from './ports/access-token-service.port';
import type { IRefreshTokenRepository } from './ports/refresh-token-repository.port';
import type {
  ISessionRevocationStore,
  SessionCacheState,
} from './ports/session-revocation-store.port';
import type { IUserRepository } from './ports/user-repository.port';

/** Gắn vào `req.user` (module augmentation ở presentation — ADR-014). */
export interface AuthenticatedUser {
  id: string;
  sid: string;
  tv: number;
}

export interface AccessTokenAuthenticatorDeps {
  accessTokens: IAccessTokenService;
  store: ISessionRevocationStore;
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  logger: ILogger;
}

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/**
 * Lõi của middleware `authenticate` (security.md 2.5), thuần — không phụ thuộc Express. Lớp
 * presentation (Phase 3) chỉ đọc header, gọi hàm này và gắn kết quả vào `req.user`.
 */
export class AccessTokenAuthenticator {
  constructor(private readonly d: AccessTokenAuthenticatorDeps) {}

  async authenticate(authorization: string | undefined): Promise<AuthenticatedUser> {
    const token = BEARER.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedError();

    const result = await this.d.accessTokens.verify(token);
    if (!result.ok) {
      throw result.reason === 'expired' ? new TokenExpiredError() : new UnauthorizedError();
    }
    const { sub, sid, tv } = result.claims;

    const state = await this.#sessionState(sub, sid);
    if (state.tokenVersion === null || state.tokenVersion !== tv || state.sessionRevoked) {
      throw new UnauthorizedError();
    }
    return { id: sub, sid, tv };
  }

  async #sessionState(userId: string, sid: string): Promise<SessionCacheState> {
    let cached: SessionCacheState;
    try {
      cached = await this.d.store.read(userId, sid);
    } catch (err) {
      this.d.logger.warn({ err, userId }, 'auth.session_cache_unavailable');
      return this.#fromDatabase(userId, sid);
    }
    if (cached.tokenVersion !== null) return cached;

    // Cache miss ⇒ đọc DB rồi SET NX (không ghi đè giá trị writer vừa đặt — ALL-05).
    const tokenVersion = await this.#db(() => this.d.users.getTokenVersion(userId));
    if (tokenVersion !== null) {
      await bestEffort(this.d.logger, 'auth.session_cache_write_failed', { userId }, () =>
        this.d.store.primeTokenVersion(userId, tokenVersion),
      );
    }
    return { tokenVersion, sessionRevoked: cached.sessionRevoked };
  }

  #fromDatabase(userId: string, sid: string): Promise<SessionCacheState> {
    return this.#db(async () => {
      const [tokenVersion, sessionRevoked] = await Promise.all([
        this.d.users.getTokenVersion(userId),
        this.d.refreshTokens.isSessionRevoked(sid),
      ]);
      return { tokenVersion, sessionRevoked };
    });
  }

  /** DB cũng lỗi ⇒ fail-closed 503 (không bao giờ cho qua khi không kiểm được). */
  async #db<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (err) {
      throw new ServiceUnavailableError(undefined, err);
    }
  }
}
