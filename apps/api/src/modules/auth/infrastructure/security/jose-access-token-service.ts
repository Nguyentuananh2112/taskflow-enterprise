import { createHash, randomUUID } from 'node:crypto';

import { SignJWT, errors, jwtVerify, type JWTPayload } from 'jose';

import type {
  AccessTokenClaims,
  AccessTokenSubject,
  AccessTokenVerification,
  IAccessTokenService,
  SignedAccessToken,
} from '../../application/ports/access-token-service.port';
import type { IClock } from '../../application/ports/clock.port';

const ALG = 'HS256';
const MIN_SECRET_BYTES = 32;
const REQUIRED_CLAIMS = ['sub', 'jti', 'iat', 'exp', 'tv', 'sid'];

export interface AccessTokenConfig {
  /** JWT_ACCESS_SECRET */
  secret: string;
  /** JWT_ACCESS_SECRET_PREVIOUS — chỉ dùng để verify trong thời gian xoay khóa */
  previousSecret?: string | undefined;
  issuer: string;
  audience: string;
  ttlSeconds?: number;
  clockToleranceSeconds?: number;
}

/** kid = 16 ký tự đầu của SHA-256(secret) dạng base64url — định danh khóa, không lộ secret. */
export function deriveKeyId(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url').slice(0, 16);
}

function toKey(secret: string, name: string): Uint8Array {
  const key = new TextEncoder().encode(secret);
  if (key.length < MIN_SECRET_BYTES)
    throw new Error(`${name} phải dài tối thiểu ${MIN_SECRET_BYTES} byte`);
  return key;
}

/** jose 6 (ADR-060), HS256 + whitelist thuật toán, hỗ trợ xoay khóa theo `kid` (security.md 2.1). */
export class JoseAccessTokenService implements IAccessTokenService {
  private readonly keys = new Map<string, Uint8Array>();
  private readonly currentKid: string;
  private readonly ttl: number;
  private readonly tolerance: number;

  constructor(
    private readonly config: AccessTokenConfig,
    private readonly clock: IClock,
  ) {
    this.currentKid = deriveKeyId(config.secret);
    this.keys.set(this.currentKid, toKey(config.secret, 'JWT_ACCESS_SECRET'));
    if (config.previousSecret !== undefined && config.previousSecret !== config.secret) {
      this.keys.set(
        deriveKeyId(config.previousSecret),
        toKey(config.previousSecret, 'JWT_ACCESS_SECRET_PREVIOUS'),
      );
    }
    this.ttl = config.ttlSeconds ?? 900;
    this.tolerance = config.clockToleranceSeconds ?? 5;
  }

  async sign(subject: AccessTokenSubject): Promise<SignedAccessToken> {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const key = this.keys.get(this.currentKid);
    if (!key) throw new Error('Không có khóa ký hiện tại');
    const token = await new SignJWT({ tv: subject.tv, sid: subject.sid })
      .setProtectedHeader({ alg: ALG, kid: this.currentKid, typ: 'JWT' })
      .setSubject(subject.sub)
      .setJti(randomUUID())
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.ttl)
      .sign(key);
    return { token, expiresIn: this.ttl };
  }

  async verify(token: string): Promise<AccessTokenVerification> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          const key = header.kid === undefined ? undefined : this.keys.get(header.kid);
          if (!key) throw new Error('kid không hợp lệ');
          return key;
        },
        {
          algorithms: [ALG],
          issuer: this.config.issuer,
          audience: this.config.audience,
          clockTolerance: this.tolerance,
          currentDate: this.clock.now(),
          requiredClaims: REQUIRED_CLAIMS,
        },
      );
      const claims = toClaims(payload);
      return claims ? { ok: true, claims } : { ok: false, reason: 'invalid' };
    } catch (err) {
      // jose chỉ báo hết hạn SAU khi chữ ký hợp lệ — token giả mạo không bao giờ thành "expired".
      return { ok: false, reason: err instanceof errors.JWTExpired ? 'expired' : 'invalid' };
    }
  }
}

function toClaims(p: JWTPayload): AccessTokenClaims | null {
  const { sub, jti, iat, exp } = p;
  const tv: unknown = p['tv'];
  const sid: unknown = p['sid'];
  const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (!isNonEmpty(sub) || !isNonEmpty(jti) || !isNonEmpty(sid)) return null;
  if (typeof tv !== 'number' || !Number.isSafeInteger(tv) || tv < 0) return null;
  if (typeof iat !== 'number' || typeof exp !== 'number') return null;
  return { sub, tv, sid, jti, iat, exp };
}
