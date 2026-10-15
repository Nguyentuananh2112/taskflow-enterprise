import type { IClock, IIdGenerator } from '../../../core/domain';
import { REFRESH_ABSOLUTE_TTL_MS, RefreshToken, type SessionMeta } from '../domain/refresh-token';
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

/**
 * Người được cấp phiên. `tokenVersion` PHẢI là giá trị đọc/ghi trong CÙNG transaction (vd RETURNING của
 * `recordLogin` / `changePassword` — ADR-104), không dùng giá trị đọc trước khi verify argon2.
 */
export interface SessionSubject {
  id: string;
  tokenVersion: number;
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
  startNew(subject: SessionSubject, meta: SessionMeta): Promise<IssuedSession> {
    const now = this.d.clock.now();
    return this.#issue(subject, meta, {
      familyId: this.d.ids.next(),
      familyExpiresAt: new Date(now.getTime() + REFRESH_ABSOLUTE_TTL_MS),
    }).then(({ session }) => session);
  }

  /** Xoay: cùng family và cùng hạn tuyệt đối; trả id token mới để `markRotated`. */
  continueFamily(
    subject: SessionSubject,
    previous: RefreshToken,
    meta: SessionMeta,
  ): Promise<{ session: IssuedSession; tokenId: string }> {
    return this.#issue(subject, meta, {
      familyId: previous.familyId,
      familyExpiresAt: previous.familyExpiresAt,
    });
  }

  async #issue(
    subject: SessionSubject,
    meta: SessionMeta,
    family: { familyId: string; familyExpiresAt: Date },
  ): Promise<{ session: IssuedSession; tokenId: string }> {
    const { token, hash } = this.d.refreshTokenFactory.generate();
    const refresh = RefreshToken.issue({
      id: this.d.ids.next(),
      userId: subject.id,
      tokenHash: hash,
      familyId: family.familyId,
      familyExpiresAt: family.familyExpiresAt,
      now: this.d.clock.now(),
      meta,
    });
    await this.d.refreshTokens.add(refresh);
    // tv luôn lấy từ aggregate vừa đọc/ghi trong transaction — không copy từ token cũ (REF-12).
    const access = await this.d.accessTokens.sign({
      sub: subject.id,
      tv: subject.tokenVersion,
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
