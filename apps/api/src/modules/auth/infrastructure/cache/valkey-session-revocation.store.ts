import type {
  ISessionRevocationStore,
  SessionCacheState,
} from '../../application/ports/session-revocation-store.port';

/** TTL cache `token_version` = 60s (ADR-105, security.md 2.4): giới hạn thời gian một giá trị cũ còn sống. */
export const TOKEN_VERSION_TTL_SECONDS = 60;

/** Phần node-redis 6 mà store dùng — khai cấu trúc để test được và không kéo generic phức tạp. */
export interface ValkeyCommands {
  mGet(keys: string[]): Promise<(string | null)[]>;
  set(
    key: string,
    value: string,
    options: { expiration: { type: 'EX'; value: number }; condition?: 'NX' },
  ): Promise<unknown>;
}

const tvKey = (userId: string) => `auth:tv:${userId}`;
const sidKey = (sid: string) => `auth:sid-revoked:${sid}`;

/**
 * Valkey (ADR-063) qua node-redis 6. Mọi lệnh ném khi Valkey lỗi — use case/authenticator quyết
 * định fallback DB hay fail-closed (security.md 2.4, 6.4). Không ghi log ở đây.
 */
export class ValkeySessionRevocationStore implements ISessionRevocationStore {
  constructor(private readonly client: ValkeyCommands) {}

  /** Một round-trip `MGET` (MW-08). */
  async read(userId: string, sid: string): Promise<SessionCacheState> {
    const [tv, revoked] = await this.client.mGet([tvKey(userId), sidKey(sid)]);
    const parsed = tv === null || tv === undefined ? null : Number.parseInt(tv, 10);
    return {
      tokenVersion: parsed === null || Number.isNaN(parsed) ? null : parsed,
      sessionRevoked: revoked !== null && revoked !== undefined,
    };
  }

  /** Writer sau commit: ghi đè vô điều kiện. */
  async setTokenVersion(userId: string, tokenVersion: number): Promise<void> {
    await this.client.set(tvKey(userId), String(tokenVersion), {
      expiration: { type: 'EX', value: TOKEN_VERSION_TTL_SECONDS },
    });
  }

  /** Reader khi miss: `SET NX` — không ghi đè giá trị writer vừa đặt (ALL-05). */
  async primeTokenVersion(userId: string, tokenVersion: number): Promise<void> {
    await this.client.set(tvKey(userId), String(tokenVersion), {
      expiration: { type: 'EX', value: TOKEN_VERSION_TTL_SECONDS },
      condition: 'NX',
    });
  }

  async revokeSession(sid: string, ttlSeconds: number): Promise<void> {
    await this.client.set(sidKey(sid), '1', { expiration: { type: 'EX', value: ttlSeconds } });
  }
}
