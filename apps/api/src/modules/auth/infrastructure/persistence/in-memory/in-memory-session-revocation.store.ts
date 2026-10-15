import type {
  ISessionRevocationStore,
  SessionCacheState,
} from '../../../application/ports/session-revocation-store.port';

export type StoreOp =
  | { op: 'read'; userId: string; sid: string }
  | { op: 'setTokenVersion'; userId: string; tokenVersion: number }
  | { op: 'primeTokenVersion'; userId: string; tokenVersion: number }
  | { op: 'revokeSession'; sid: string; ttlSeconds: number };

/**
 * Valkey giả: không có TTL thật (ghi lại `ttlSeconds` để test), `failing = true` ⇒ mọi lệnh ném
 * (mô phỏng Valkey sập — MW-06/07, ALL-04).
 */
export class InMemorySessionRevocationStore implements ISessionRevocationStore {
  readonly ops: StoreOp[] = [];
  readonly tokenVersions = new Map<string, number>();
  readonly revokedSessions = new Map<string, number>();
  failing = false;

  read(userId: string, sid: string): Promise<SessionCacheState> {
    return this.#do({ op: 'read', userId, sid }, () => ({
      tokenVersion: this.tokenVersions.get(userId) ?? null,
      sessionRevoked: this.revokedSessions.has(sid),
    }));
  }

  setTokenVersion(userId: string, tokenVersion: number): Promise<void> {
    return this.#do({ op: 'setTokenVersion', userId, tokenVersion }, () => {
      this.tokenVersions.set(userId, tokenVersion);
    });
  }

  primeTokenVersion(userId: string, tokenVersion: number): Promise<void> {
    return this.#do({ op: 'primeTokenVersion', userId, tokenVersion }, () => {
      if (!this.tokenVersions.has(userId)) this.tokenVersions.set(userId, tokenVersion);
    });
  }

  revokeSession(sid: string, ttlSeconds: number): Promise<void> {
    return this.#do({ op: 'revokeSession', sid, ttlSeconds }, () => {
      this.revokedSessions.set(sid, ttlSeconds);
    });
  }

  #do<T>(record: StoreOp, action: () => T): Promise<T> {
    this.ops.push(record);
    if (this.failing) return Promise.reject(new Error('Valkey không khả dụng (giả lập)'));
    return Promise.resolve(action());
  }
}
