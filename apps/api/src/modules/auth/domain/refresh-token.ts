import { Entity } from '../../../core/domain';

const DAY_MS = 86_400_000;
export const REFRESH_SLIDING_TTL_MS = 7 * DAY_MS;
export const REFRESH_ABSOLUTE_TTL_MS = 30 * DAY_MS;
/** Hai tab refresh cùng lúc: token vừa xoay < 10s ⇒ không coi là reuse (security.md 1.4). */
export const REFRESH_ROTATION_GRACE_MS = 10_000;
const USER_AGENT_MAX = 255;

export type RefreshTokenRevokeReason =
  'ROTATED' | 'LOGOUT' | 'LOGOUT_ALL' | 'REUSE_DETECTED' | 'PASSWORD_CHANGED' | 'USER_DELETED';

/**
 * Kết quả khi client trình token:
 * - `valid`: được xoay; `expired` / `revoked`: từ chối, không thu hồi gì thêm;
 * - `superseded`: vừa xoay trong cửa sổ ân hạn ⇒ 409, không cấp, không thu hồi;
 * - `reused`: token đã xoay bị dùng lại ⇒ thu hồi cả family.
 */
export type RefreshTokenUse = 'valid' | 'expired' | 'revoked' | 'superseded' | 'reused';

export interface SessionMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface RefreshTokenSnapshot extends SessionMeta {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  replacedById: string | null;
  expiresAt: Date;
  familyExpiresAt: Date;
  revokedAt: Date | null;
  revokedReason: RefreshTokenRevokeReason | null;
  createdAt: Date;
}

/**
 * Một refresh token trong family (ADR-024). Chỉ lưu hash. Thay đổi trạng thái (xoay, thu hồi)
 * đi qua repository bằng UPDATE có điều kiện để chống race — entity chỉ đánh giá.
 */
export class RefreshToken extends Entity {
  private constructor(private readonly s: RefreshTokenSnapshot) {
    super(s.id);
  }

  static issue(input: {
    id: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    familyExpiresAt: Date;
    now: Date;
    meta: SessionMeta;
  }): RefreshToken {
    const sliding = input.now.getTime() + REFRESH_SLIDING_TTL_MS;
    return new RefreshToken({
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      replacedById: null,
      expiresAt: new Date(Math.min(sliding, input.familyExpiresAt.getTime())),
      familyExpiresAt: input.familyExpiresAt,
      revokedAt: null,
      revokedReason: null,
      userAgent: input.meta.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
      ip: input.meta.ip,
      createdAt: input.now,
    });
  }

  static reconstitute(snapshot: RefreshTokenSnapshot): RefreshToken {
    return new RefreshToken({ ...snapshot });
  }

  get userId(): string {
    return this.s.userId;
  }
  get familyId(): string {
    return this.s.familyId;
  }
  get tokenHash(): string {
    return this.s.tokenHash;
  }
  get expiresAt(): Date {
    return this.s.expiresAt;
  }
  get familyExpiresAt(): Date {
    return this.s.familyExpiresAt;
  }
  get revokedAt(): Date | null {
    return this.s.revokedAt;
  }
  get revokedReason(): RefreshTokenRevokeReason | null {
    return this.s.revokedReason;
  }
  get replacedById(): string | null {
    return this.s.replacedById;
  }
  get userAgent(): string | null {
    return this.s.userAgent;
  }
  get ip(): string | null {
    return this.s.ip;
  }

  assess(now: Date): RefreshTokenUse {
    const { revokedAt, revokedReason } = this.s;
    if (revokedAt !== null) {
      if (revokedReason !== 'ROTATED') return 'revoked';
      return now.getTime() - revokedAt.getTime() < REFRESH_ROTATION_GRACE_MS
        ? 'superseded'
        : 'reused';
    }
    const t = now.getTime();
    if (t >= this.s.expiresAt.getTime() || t >= this.s.familyExpiresAt.getTime()) return 'expired';
    return 'valid';
  }

  toSnapshot(): RefreshTokenSnapshot {
    return { ...this.s };
  }
}
