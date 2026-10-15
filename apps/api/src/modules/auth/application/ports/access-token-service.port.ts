/** Claims mà use case cung cấp khi ký (security.md 2.1). Không có role/workspace/email. */
export interface AccessTokenSubject {
  /** userId */
  sub: string;
  /** users.token_version lúc ký (ADR-025) */
  tv: number;
  /** familyId của phiên refresh (logout 1 thiết bị, room socket) */
  sid: string;
}

export interface AccessTokenClaims extends AccessTokenSubject {
  jti: string;
  /** giây kể từ epoch */
  iat: number;
  exp: number;
}

export interface SignedAccessToken {
  token: string;
  /** giây — trả về cho client (`expiresIn`) */
  expiresIn: number;
}

/**
 * `expired` ⇒ API trả `401 TOKEN_EXPIRED` (FE tự refresh); `invalid` ⇒ `401 UNAUTHORIZED`.
 * Lý do chi tiết không được lộ ra client.
 */
export type AccessTokenVerification =
  { ok: true; claims: AccessTokenClaims } | { ok: false; reason: 'expired' | 'invalid' };

export interface IAccessTokenService {
  sign(subject: AccessTokenSubject): Promise<SignedAccessToken>;
  /** Chỉ kiểm chữ ký + claims. So `tv`/`sid` với cache là việc của middleware `authenticate`. */
  verify(token: string): Promise<AccessTokenVerification>;
}
