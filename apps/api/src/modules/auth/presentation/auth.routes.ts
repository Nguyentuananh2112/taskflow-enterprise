import {
  ActivateBody,
  ActivationInspectBody,
  ChangePasswordBody,
  LoginBody,
  UpdateMeBody,
} from '@taskflow/contracts';
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

  // Mốc 3.5 (ADR-137): KHÔNG còn `/register` — tài khoản do HR / `admin:bootstrap` tạo, người dùng kích hoạt.
  // Công khai: Origin cho phép + hạn mức IP chung cho inspect / activate (SEC-HR-57), TRƯỚC validate.
  router.post(
    '/activation/inspect',
    d.requireAllowedOrigin,
    ...d.limit(RATE_LIMIT_RULES.activation),
    validate({ body: ActivationInspectBody }),
    c.inspectActivation,
  );
  router.post(
    '/activate',
    d.requireAllowedOrigin,
    ...d.limit(RATE_LIMIT_RULES.activation),
    validate({ body: ActivateBody }),
    c.activate,
  );
  // ADR-108: limiter IP trước validate; limiter theo email (chỉ đếm 401) SAU validate.
  router.post(
    '/login',
    ...d.limit(RATE_LIMIT_RULES.loginIp),
    validate({ body: LoginBody }),
    ...d.limit(RATE_LIMIT_RULES.login),
    c.login,
  );
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
