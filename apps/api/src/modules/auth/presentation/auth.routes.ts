import { ChangePasswordBody, LoginBody, RegisterBody, UpdateMeBody } from '@taskflow/contracts';
import { Router, type RequestHandler } from 'express';

import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { validate } from '../../../core/http/validate';
import type { AuthController } from './auth.controller';

export interface AuthRouteDeps {
  controller: AuthController;
  authenticate: RequestHandler;
  /** Origin ∈ whitelist cho endpoint dùng cookie (security §6.3) ⇒ 403 `ORIGIN_NOT_ALLOWED`. */
  requireAllowedOrigin: RequestHandler;
  /** Middleware rate limit cho một bộ rule (Valkey ở production, bộ nhớ trong test). */
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
}

/** Response chứa token không được cache (security §6.2). */
const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/**
 * `/api/v1/auth` (data-and-api §2.4). Thứ tự mỗi route: Origin (endpoint cookie) → rate limit →
 * authenticate → rate limit theo user → validate body → controller.
 */
export function authRoutes(d: AuthRouteDeps): Router {
  const router = Router();
  const c = d.controller;
  const authed = [d.authenticate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  router.use(noStore);

  router.post(
    '/register',
    ...d.limit(RATE_LIMIT_RULES.register),
    validate({ body: RegisterBody }),
    c.register,
  );
  router.post('/login', ...d.limit(RATE_LIMIT_RULES.login), validate({ body: LoginBody }), c.login);
  router.post('/refresh', d.requireAllowedOrigin, ...d.limit(RATE_LIMIT_RULES.refresh), c.refresh);
  router.post('/logout', d.requireAllowedOrigin, ...d.limit(RATE_LIMIT_RULES.logout), c.logout);
  router.post('/logout-all', ...authed, ...d.limit(RATE_LIMIT_RULES.logoutAll), c.logoutAll);
  router.get('/me', ...authed, c.me);
  router.patch(
    '/me',
    ...authed,
    ...d.limit(RATE_LIMIT_RULES.updateMe),
    validate({ body: UpdateMeBody }),
    c.updateMe,
  );
  router.post(
    '/change-password',
    ...authed,
    ...d.limit(RATE_LIMIT_RULES.changePassword),
    validate({ body: ChangePasswordBody }),
    c.changePassword,
  );
  return router;
}
