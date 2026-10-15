import type { IClock } from '../../../core/domain';
import {
  ServiceUnavailableError,
  TokenExpiredError,
  UnauthorizedError,
} from '../../../core/errors';
import type { ILogger } from '../../../core/logging/logger';
import { bestEffort, SESSION_REVOCATION_TTL_SECONDS } from './auth-shared';
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
  /** Hạn access token (giây kể từ epoch) — socket dùng để hẹn giờ `auth:expired` (security.md 5.3). */
  exp: number;
}

export interface AccessTokenAuthenticatorDeps {
  accessTokens: IAccessTokenService;
  store: ISessionRevocationStore;
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  logger: ILogger;
  clock: IClock;
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
    const { sub, sid, tv, exp } = result.claims;

    const state = await this.#sessionState(sub, sid);
    if (state.tokenVersion === null || state.tokenVersion !== tv || state.sessionRevoked) {
      throw new UnauthorizedError();
    }
    return { id: sub, sid, tv, exp };
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

    // Cache miss ⇒ Valkey có thể vừa mất dữ liệu (restart, không persistence): KHÔNG tin việc thiếu
    // khóa `sid-revoked` — kiểm cả `tv` lẫn phiên trong DB (X3, T-032).
    const fromDb = await this.#fromDatabase(userId, sid);
    const { tokenVersion } = fromDb;
    if (tokenVersion !== null) {
      await bestEffort(this.d.logger, 'auth.session_cache_write_failed', { userId }, () =>
        this.#refill(userId, tokenVersion),
      );
    }
    return { tokenVersion, sessionRevoked: cached.sessionRevoked || fromDb.sessionRevoked };
  }

  /**
   * Nạp lại cache cho user: khôi phục `sid-revoked` của mọi phiên bị thu hồi trong cửa sổ TTL access
   * token TRƯỚC, rồi mới `SET NX` `tv`. Lý do: một lần trúng cache `tv` không còn hỏi DB về `sid` —
   * nếu nạp `tv` mà thiếu `sid-revoked`, phiên đã đăng xuất khác của cùng user sẽ được cho qua.
   * Khôi phục lỗi ⇒ ném trước khi nạp `tv` ⇒ lần sau vẫn miss và hỏi DB (fail-closed).
   */
  async #refill(userId: string, tokenVersion: number): Promise<void> {
    const now = this.d.clock.now().getTime();
    const windowMs = SESSION_REVOCATION_TTL_SECONDS * 1000;
    const revoked = await this.d.refreshTokens.listRevokedSessionsSince(
      userId,
      new Date(now - windowMs),
    );
    for (const { familyId, revokedAt } of revoked) {
      const ttlSeconds = Math.ceil((revokedAt.getTime() + windowMs - now) / 1000);
      if (ttlSeconds > 0) await this.d.store.revokeSession(familyId, ttlSeconds);
    }
    await this.d.store.primeTokenVersion(userId, tokenVersion);
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
