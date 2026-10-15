import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';

import { ServiceUnavailableError } from '../../errors';
import type { ILogger } from '../../logging/logger';
import type { RateLimitRule } from './rules';

/**
 * `RedisStore` của rate-limit-redis 6 nạp Lua script trong `init()` và GIỮ promise đó: nếu Valkey
 * đang sập lúc khởi động, promise bị reject vĩnh viễn ⇒ limiter không bao giờ hồi phục, và nếu
 * không ai await thì thành unhandledRejection (ở T-009 = tắt tiến trình). Lớp con này nạp lại
 * script sau mỗi lần lỗi và không để promise reject trôi nổi.
 */
export class ResilientRedisStore extends RedisStore {
  /** Script cần nạp lại ở lần gọi KẾ TIẾP (nạp lại ngay lúc lỗi thì Valkey vẫn đang sập). */
  #stale = false;

  override init(options: Options): Promise<void> {
    this.windowMs = options.windowMs;
    this.#loadScripts();
    return Promise.resolve();
  }

  override async increment(key: string): Promise<ClientRateLimitInfo> {
    if (this.#stale) this.#loadScripts();
    try {
      return await super.increment(key);
    } catch (err) {
      this.#stale = true;
      throw err;
    }
  }

  #loadScripts(): void {
    this.#stale = false;
    this.incrementScriptSha = this.loadIncrementScript();
    this.getScriptSha = this.loadGetScript();
    // Lỗi được báo ở increment; không để promise reject trôi nổi (unhandledRejection).
    const markStale = () => void (this.#stale = true);
    this.incrementScriptSha.catch(markStale);
    this.getScriptSha.catch(markStale);
  }
}

/** Client tối thiểu cho store: `sendCommand` của node-redis (Valkey — ADR-063). */
export interface CommandSender {
  sendCommand(args: string[]): Promise<unknown>;
}

export function createValkeyStore(client: CommandSender, rule: RateLimitRule): Store {
  return new ResilientRedisStore({
    prefix: `rl:${rule.id}:`,
    sendCommand: (...args: string[]) => client.sendCommand(args) as Promise<RedisReply>,
  });
}

/**
 * Áp chế độ lỗi của rule lên store (ADR-074): `closed` ⇒ ném `ServiceUnavailableError` (503);
 * `open` ⇒ cho qua như lượt đầu tiên + log cảnh báo (tối đa 1 lần/30s mỗi rule).
 */
export class FailModeStore implements Store {
  readonly localKeys: boolean;
  readonly prefix?: string;
  #windowMs = 60_000;
  #lastWarnAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly inner: Store,
    private readonly rule: RateLimitRule,
    private readonly logger: ILogger,
    private readonly now: () => number = Date.now,
  ) {
    this.localKeys = inner.localKeys ?? false;
    if (inner.prefix !== undefined) this.prefix = inner.prefix;
  }

  async init(options: Options): Promise<void> {
    this.#windowMs = options.windowMs;
    await this.inner.init?.(options);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      return await this.inner.increment(key);
    } catch (err) {
      if (this.rule.failMode === 'closed') {
        this.logger.error({ err, rule: this.rule.id }, 'rate_limit.store_unavailable_fail_closed');
        throw new ServiceUnavailableError(undefined, err);
      }
      this.#warnOpen(err);
      return { totalHits: 1, resetTime: new Date(this.now() + this.#windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.inner.decrement(key);
    } catch (err) {
      this.#warnOpen(err);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.inner.resetKey(key);
  }

  #warnOpen(err: unknown): void {
    const now = this.now();
    if (now - this.#lastWarnAt < 30_000) return;
    this.#lastWarnAt = now;
    this.logger.warn({ err, rule: this.rule.id }, 'rate_limit.store_unavailable_fail_open');
  }
}
