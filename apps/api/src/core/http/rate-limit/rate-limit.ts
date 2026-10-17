import { createHash } from 'node:crypto';

import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Store } from 'express-rate-limit';

import { RateLimitedError } from '../../errors';
import type { ILogger } from '../../logging/logger';
import { RATE_LIMIT_RULES, type RateLimitKey, type RateLimitRule } from './rules';
import { FailModeStore } from './store';

export interface RateLimitDeps {
  /** Store cho từng rule — production: `createValkeyStore(valkey, rule)`; test: `MemoryStore`. */
  storeFor(rule: RateLimitRule): Store;
  logger: ILogger;
  /** userId đã xác thực của request (middleware `authenticate` của auth gắn) — undefined nếu chưa. */
  userIdOf(req: Request): string | undefined;
  now?: () => number;
}

export function hashEmail(email: unknown): string {
  const normalized = typeof email === 'string' ? email.trim().normalize('NFC').toLowerCase() : '';
  return normalized ? createHash('sha256').update(normalized).digest('hex') : 'no-email';
}

/** IP thật (Express `req.ip` đã áp `trust proxy`), IPv6 gom theo /56 (express-rate-limit 8). */
export function ipKey(ip: string | undefined): string {
  return ipKeyGenerator(ip ?? '0.0.0.0', 56);
}

function keyOf(kind: RateLimitKey, req: Request, deps: RateLimitDeps): string {
  const body = req.body as { email?: unknown } | undefined;
  switch (kind) {
    case 'ip':
      return ipKey(req.ip);
    case 'user': {
      const userId = deps.userIdOf(req);
      return userId ? `u:${userId}` : `ip:${ipKey(req.ip)}`;
    }
    case 'email':
      return hashEmail(body?.email);
    case 'ip+email':
      return `${ipKey(req.ip)}|${hashEmail(body?.email)}`;
    case 'target':
      return `t:${(req.params as { userId?: string }).userId ?? ''}`;
  }
}

/**
 * Middleware rate limit cho một rule (express-rate-limit 8, header chuẩn draft-8).
 * Vượt ngưỡng ⇒ `429 RATE_LIMITED` + `Retry-After` qua error handler chung.
 */
export function createRateLimit(rule: RateLimitRule, deps: RateLimitDeps): RequestHandler {
  const now = deps.now ?? Date.now;
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: rule.id,
    skipSuccessfulRequests: Boolean(rule.countFailedOnly ?? rule.countOnlyStatuses),
    ...(rule.countOnlyStatuses
      ? {
          requestWasSuccessful: (_req: Request, res: { statusCode: number }) =>
            !rule.countOnlyStatuses?.includes(res.statusCode),
        }
      : {}),
    store: new FailModeStore(deps.storeFor(rule), rule, deps.logger, now),
    keyGenerator: (req) => keyOf(rule.key, req, deps),
    handler: (req, _res, next) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit
        ?.resetTime;
      const retryAfterSec = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - now()) / 1000))
        : Math.ceil(rule.windowMs / 1000);
      next(new RateLimitedError(retryAfterSec));
    },
    // Lỗi store đã được FailModeStore xử lý theo failMode — không để thư viện tự quyết.
    passOnStoreError: false,
  });
}

export interface GlobalRateLimitRules {
  anonymous: RateLimitRule;
  bearerIp: RateLimitRule;
  authFailure: RateLimitRule;
}

const DEFAULT_GLOBAL_RULES: GlobalRateLimitRules = {
  anonymous: RATE_LIMIT_RULES.anonymous[0],
  bearerIp: RATE_LIMIT_RULES.bearerIp[0],
  authFailure: RATE_LIMIT_RULES.authFailure[0],
};

/**
 * Giới hạn toàn cục theo IP — MỌI request đều qua ít nhất một bucket IP (security §6.4):
 * - không có `Authorization`: 100/phút/IP;
 * - có `Authorization` (token thật hay rác): trần thô 1000/phút/IP **và** 30 lần 401/phút/IP —
 *   token rác hết lượt là bị chặn ở đây, trước khi tốn CPU verify.
 * Route đã xác thực gắn thêm `RATE_LIMIT_RULES.authenticated` (300/phút/user) SAU `authenticate`.
 */
export function createGlobalRateLimit(
  deps: RateLimitDeps,
  rules: GlobalRateLimitRules = DEFAULT_GLOBAL_RULES,
): RequestHandler[] {
  const when =
    (withToken: boolean, limiter: RequestHandler): RequestHandler =>
    (req, res, next) => {
      if (Boolean(req.headers.authorization) !== withToken) {
        next();
        return;
      }
      void limiter(req, res, next);
    };
  return [
    when(false, createRateLimit(rules.anonymous, deps)),
    when(true, createRateLimit(rules.authFailure, deps)),
    when(true, createRateLimit(rules.bearerIp, deps)),
  ];
}

/** Nhiều rule cho một route (vd login 3 lớp) — áp tuần tự. */
export function createRateLimits(
  rules: readonly RateLimitRule[],
  deps: RateLimitDeps,
): RequestHandler[] {
  return rules.map((r) => createRateLimit(r, deps));
}

export interface HitResult {
  allowed: boolean;
  retryAfterSec: number;
}

/** Đếm lượt ngoài Express (vd handshake Socket.io) trên cùng store/chế độ lỗi. */
export interface IHitLimiter {
  hit(key: string): Promise<HitResult>;
}

export function createHitLimiter(
  rule: RateLimitRule,
  deps: Omit<RateLimitDeps, 'userIdOf'>,
): IHitLimiter {
  const now = deps.now ?? Date.now;
  const store = new FailModeStore(deps.storeFor(rule), rule, deps.logger, now);
  const ready = store.init({ windowMs: rule.windowMs } as Parameters<Store['init'] & object>[0]);
  return {
    async hit(key) {
      await ready;
      const { totalHits, resetTime } = await store.increment(key);
      const retryAfterSec = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - now()) / 1000))
        : Math.ceil(rule.windowMs / 1000);
      return { allowed: totalHits <= rule.limit, retryAfterSec };
    },
  };
}
