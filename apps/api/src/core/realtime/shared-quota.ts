import { randomUUID } from 'node:crypto';

import type { Store } from 'express-rate-limit';

import type { IClock } from '../domain';
import type { ILogger } from '../logging/logger';
import { createValkeyStore, type CommandSender } from '../http/rate-limit/store';
import {
  AUTH_RENEW_LIMIT,
  MAX_SOCKETS_PER_USER,
  PROJECT_JOIN_LIMIT_PER_USER,
  type RateLimitRule,
} from '../http/rate-limit/rules';
import { LocalRealtimeQuota, type IRealtimeQuota } from './quota';
import {
  ACQUIRE_SCRIPT,
  HEARTBEAT_BATCH,
  HEARTBEAT_MS,
  HEARTBEAT_SCRIPT,
  INSTANCES_KEY,
  INSTANCE_ALIVE_MS,
  INSTANCE_PRUNE_MS,
  RELEASE_SCRIPT,
  SOCKET_HASH_TTL_MS,
  SOCKET_KEY,
} from './shared-quota.scripts';

export type QuotaFallbackKind = 'socket' | 'join' | 'renew' | 'heartbeat';

export interface SharedRealtimeQuotaOptions {
  valkey: CommandSender;
  local: IRealtimeQuota;
  instanceId: string;
  logger: ILogger;
  onFallback?: (kind: QuotaFallbackKind) => void;
  /** Mặc định `setInterval` thật; test truyền vào để chạy tay. */
  heartbeatMs?: number;
}

const userRule = (id: string, r: { windowMs: number; limit: number }): RateLimitRule => ({
  id,
  windowMs: r.windowMs,
  limit: r.limit,
  key: 'user',
  failMode: 'open',
});

/**
 * Hạn mức realtime theo user DÙNG CHUNG giữa các instance (ADR-115) — chỉ bật khi
 * `SOCKET_REDIS_ADAPTER=true`. Bọc bản Local: Local LUÔN kiểm trước (trần theo instance luôn có);
 * Local cho qua thì mới đếm chung. Valkey lỗi ⇒ chỉ còn Local (trần nhân số instance — chấp nhận có
 * chủ đích, cùng nhóm R5) + log `warn` (≤ 1 lần/30 s mỗi loại) + metric `onFallback(kind)`.
 *
 * **Yêu cầu Valkey single-node / primary** (đúng cả hai phương án hosting — ADR-070): script socket đọc
 * `rt:sock:{userId}` và `rt:instances` — hai khóa khác hash slot ⇒ CROSSSLOT trên Valkey Cluster.
 *
 * Socket: `rt:sock:{userId}` = HASH instanceId → số socket; `rt:instances` = ZSET instanceId → lần
 * heartbeat cuối. Mọi mốc thời gian lấy `TIME` của Valkey (không phải đồng hồ instance — lệch giờ
 * giữa container làm instance sống bị coi là chết ⇒ hở trần, hoặc ngược lại). Heartbeat ghi lại số
 * socket THẬT của instance này ⇒ release bị mất (Valkey lỗi, socket bỏ đi giữa handshake) tự sửa.
 */
export class SharedRealtimeQuota implements IRealtimeQuota {
  readonly #joins: { store: Store; rule: RateLimitRule };
  readonly #renews: { store: Store; rule: RateLimitRule };
  readonly #lastWarn = new Map<QuotaFallbackKind, number>();
  /** User đã ghi field của instance này ⇒ heartbeat phải ghi lại (hoặc xóa khi về 0). */
  readonly #synced = new Set<string>();
  #localCounts: () => ReadonlyMap<string, number> = () => new Map();
  #timer: NodeJS.Timeout | undefined;

  constructor(private readonly o: SharedRealtimeQuotaOptions) {
    const make = (rule: RateLimitRule) => {
      const store = createValkeyStore(o.valkey, rule);
      void store.init?.({ windowMs: rule.windowMs } as Parameters<NonNullable<Store['init']>>[0]);
      return { store, rule };
    };
    this.#joins = make(userRule('rt-join-user', PROJECT_JOIN_LIMIT_PER_USER));
    this.#renews = make(userRule('rt-renew-user', AUTH_RENEW_LIMIT.user));
  }

  /** Gateway gọi khi khởi tạo: nguồn số socket thật theo user của instance này. */
  start(localCounts: () => ReadonlyMap<string, number>): void {
    this.#localCounts = localCounts;
    this.o.local.start(localCounts);
    if (this.o.heartbeatMs === 0) return;
    void this.heartbeat();
    this.#timer = setInterval(() => void this.heartbeat(), this.o.heartbeatMs ?? HEARTBEAT_MS);
    this.#timer.unref();
  }

  async tryJoin(userId: string): Promise<boolean> {
    return (await this.o.local.tryJoin(userId)) && this.#hit(this.#joins, userId, 'join');
  }

  async tryRenew(userId: string): Promise<boolean> {
    return (await this.o.local.tryRenew(userId)) && this.#hit(this.#renews, userId, 'renew');
  }

  async acquireSocket(userId: string, localCount: number): Promise<boolean> {
    if (!(await this.o.local.acquireSocket(userId, localCount))) return false;
    try {
      const keys = [SOCKET_KEY(userId), INSTANCES_KEY];
      const args = [this.o.instanceId, MAX_SOCKETS_PER_USER, INSTANCE_ALIVE_MS, SOCKET_HASH_TTL_MS];
      const granted = Number(await this.#eval(ACQUIRE_SCRIPT, keys, args.map(String))) === 1;
      if (granted) this.#synced.add(userId);
      return granted;
    } catch (err) {
      this.#fallback('socket', err);
      return true; // Local đã cho qua
    }
  }

  async releaseSocket(userId: string): Promise<void> {
    await this.o.local.releaseSocket(userId);
    try {
      await this.#eval(RELEASE_SCRIPT, [SOCKET_KEY(userId)], [this.o.instanceId]);
    } catch (err) {
      this.#fallback('socket', err); // heartbeat kế tiếp ghi lại số thật
    }
  }

  /** Ghi heartbeat + số socket thật của instance, theo lô `HEARTBEAT_BATCH` user mỗi EVAL. */
  async heartbeat(): Promise<void> {
    const counts = this.#localCounts();
    const users = [...new Set([...this.#synced, ...counts.keys()])];
    try {
      for (let i = 0; i === 0 || i < users.length; i += HEARTBEAT_BATCH) {
        const batch = users.slice(i, i + HEARTBEAT_BATCH);
        await this.#eval(
          HEARTBEAT_SCRIPT,
          [INSTANCES_KEY, ...batch.map(SOCKET_KEY)],
          [
            this.o.instanceId,
            String(SOCKET_HASH_TTL_MS),
            String(INSTANCE_PRUNE_MS),
            ...batch.map((u) => String(counts.get(u) ?? 0)),
          ],
        );
      }
      this.#synced.clear();
      for (const [u, n] of counts) if (n > 0) this.#synced.add(u);
    } catch (err) {
      this.#fallback('heartbeat', err);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.#timer);
    const users = [...this.#synced];
    this.#synced.clear();
    try {
      for (const u of users)
        await this.o.valkey.sendCommand(['HDEL', SOCKET_KEY(u), this.o.instanceId]);
      await this.o.valkey.sendCommand(['ZREM', INSTANCES_KEY, this.o.instanceId]);
    } catch (err) {
      this.#fallback('heartbeat', err); // instance hết "sống" sau INSTANCE_ALIVE_MS
    }
    await this.o.local.close();
  }

  async #hit(
    limiter: { store: Store; rule: RateLimitRule },
    userId: string,
    kind: QuotaFallbackKind,
  ): Promise<boolean> {
    try {
      const { totalHits } = await limiter.store.increment(userId);
      return totalHits <= limiter.rule.limit;
    } catch (err) {
      this.#fallback(kind, err);
      return true; // Local đã cho qua
    }
  }

  #eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    return this.o.valkey.sendCommand(['EVAL', script, String(keys.length), ...keys, ...args]);
  }

  #fallback(kind: QuotaFallbackKind, err: unknown): void {
    this.o.onFallback?.(kind);
    const now = Date.now();
    if (now - (this.#lastWarn.get(kind) ?? Number.NEGATIVE_INFINITY) < 30_000) return;
    this.#lastWarn.set(kind, now);
    this.o.logger.warn({ err, kind }, 'realtime.quota_shared_unavailable_local_only');
  }
}

/**
 * Composition root: `shared` (= `SOCKET_REDIS_ADAPTER`, > 1 instance) ⇒ bản dùng chung với instanceId
 * ngẫu nhiên mỗi lần khởi động (không dùng hostname — hai container có thể trùng); ngược lại chỉ Local.
 */
export function createRealtimeQuota(o: {
  shared: boolean;
  valkey: CommandSender;
  clock: IClock;
  logger: ILogger;
  /** `AppMetrics` — metric `realtime_quota_fallback_total{kind}` (nhãn cố định 4 giá trị). */
  metrics?: { counter(name: string, help: string, label: 'kind'): (value: string) => void };
}): IRealtimeQuota {
  const local = new LocalRealtimeQuota(o.clock);
  if (!o.shared) return local;
  const onFallback = o.metrics?.counter(
    'realtime_quota_fallback_total',
    'Hạn mức realtime dùng chung lỗi Valkey ⇒ chỉ còn hạn mức cục bộ',
    'kind',
  );
  return new SharedRealtimeQuota({
    valkey: o.valkey,
    local,
    instanceId: randomUUID(),
    logger: o.logger,
    ...(onFallback ? { onFallback } : {}),
  });
}
