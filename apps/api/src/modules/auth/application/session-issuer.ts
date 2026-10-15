import type { IClock, IIdGenerator } from '../../../core/domain';
import { REFRESH_ABSOLUTE_TTL_MS, RefreshToken, type SessionMeta } from '../domain/refresh-token';
import type { User } from '../domain/user';
import type { IAccessTokenService } from './ports/access-token-service.port';
import type { IRefreshTokenFactory } from './ports/refresh-token-factory.port';
import type { IRefreshTokenRepository } from './ports/refresh-token-repository.port';

/** Thứ presentation cần để trả body + đặt cookie. `refreshToken` thô KHÔNG được log. */
export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  familyId: string;
}

export interface SessionIssuerDeps {
  refreshTokens: IRefreshTokenRepository;
  refreshTokenFactory: IRefreshTokenFactory;
  accessTokens: IAccessTokenService;
  ids: IIdGenerator;
  clock: IClock;
}

/** Cấp phiên (refresh token mới + access token). Gọi BÊN TRONG `uow.run`. */
export class SessionIssuer {
  constructor(private readonly d: SessionIssuerDeps) {}

  /** Login/register/đổi mật khẩu: family mới, hạn tuyệt đối = now + 30 ngày. */
  startNew(user: User, meta: SessionMeta): Promise<IssuedSession> {
    const now = this.d.clock.now();
    return this.#issue(user, meta, {
      familyId: this.d.ids.next(),
      familyExpiresAt: new Date(now.getTime() + REFRESH_ABSOLUTE_TTL_MS),
    }).then(({ session }) => session);
  }

  /** Xoay: cùng family và cùng hạn tuyệt đối; trả id token mới để `markRotated`. */
  continueFamily(
    user: User,
    previous: RefreshToken,
    meta: SessionMeta,
  ): Promise<{ session: IssuedSession; tokenId: string }> {
    return this.#issue(user, meta, {
      familyId: previous.familyId,
      familyExpiresAt: previous.familyExpiresAt,
    });
  }

  async #issue(
    user: User,
    meta: SessionMeta,
    family: { familyId: string; familyExpiresAt: Date },
  ): Promise<{ session: IssuedSession; tokenId: string }> {
    const { token, hash } = this.d.refreshTokenFactory.generate();
    const refresh = RefreshToken.issue({
      id: this.d.ids.next(),
      userId: user.id,
      tokenHash: hash,
      familyId: family.familyId,
      familyExpiresAt: family.familyExpiresAt,
      now: this.d.clock.now(),
      meta,
    });
    await this.d.refreshTokens.add(refresh);
    // tv luôn lấy từ aggregate vừa đọc/ghi trong transaction — không copy từ token cũ (REF-12).
    const access = await this.d.accessTokens.sign({
      sub: user.id,
      tv: user.tokenVersion,
      sid: family.familyId,
    });
    return {
      tokenId: refresh.id,
      session: {
        accessToken: access.token,
        expiresIn: access.expiresIn,
        refreshToken: token,
        refreshExpiresAt: refresh.expiresAt,
        familyId: family.familyId,
      },
    };
  }
}
