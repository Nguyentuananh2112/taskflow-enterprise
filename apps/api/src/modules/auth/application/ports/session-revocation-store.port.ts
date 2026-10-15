export interface SessionCacheState {
  /** `null` = cache miss ⇒ đọc DB rồi `primeTokenVersion` */
  tokenVersion: number | null;
  sessionRevoked: boolean;
}

/**
 * Cache Valkey (security.md 2.4): `auth:tv:{userId}` và `auth:sid-revoked:{familyId}`.
 * Mọi method có thể ném khi Valkey lỗi — người gọi quyết định fallback/ghi log.
 */
export interface ISessionRevocationStore {
  /** Một round-trip (`MGET auth:tv:{userId} auth:sid-revoked:{sid}`) — MW-08. */
  read(userId: string, sid: string): Promise<SessionCacheState>;
  /** Writer sau commit: `SET … EX` vô điều kiện. */
  setTokenVersion(userId: string, tokenVersion: number): Promise<void>;
  /** Reader khi miss: `SET … NX EX` — không bao giờ ghi đè giá trị writer vừa đặt (ALL-05). */
  primeTokenVersion(userId: string, tokenVersion: number): Promise<void>;
  /** `SET auth:sid-revoked:{sid} 1 EX ttlSeconds` (= TTL access token). */
  revokeSession(sid: string, ttlSeconds: number): Promise<void>;
}
