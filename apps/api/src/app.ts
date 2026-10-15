import express, { type Express, type RequestHandler, type Router } from 'express';
import type { Logger } from 'pino';

import type { Env } from './config/env';
import type { IClock } from './core/domain';
import { HttpResponder } from './core/http/envelope';
import { globalErrorHandler, notFoundHandler } from './core/http/error-handler';
import { healthRouter, type ReadinessProbe } from './core/http/health';
import {
  jsonBody,
  requestLogging,
  requireJsonContentType,
  securityHeaders,
} from './core/http/middleware';

export interface AppConfig {
  gitSha: string;
  corsOrigins: readonly string[];
  trustProxyHops: number;
  /** Ẩn chi tiết lỗi 500 (`NODE_ENV=production`). */
  production: boolean;
  /** HSTS chỉ khi `APP_ENV ∈ {staging, production}` (ADR-101) — không bao giờ ở local/E2E http. */
  hsts: boolean;
  bodyLimit: string;
}

export function appConfigFromEnv(env: Env): AppConfig {
  return {
    gitSha: env.GIT_SHA,
    corsOrigins: env.CORS_ORIGINS,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    production: env.NODE_ENV === 'production',
    hsts: env.APP_ENV === 'staging' || env.APP_ENV === 'production',
    bodyLimit: '100kb', // ADR-028, security.md §6.7
  };
}

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  clock: IClock;
  responder?: HttpResponder;
  probes: readonly ReadinessProbe[];
  isShuttingDown: () => boolean;
  /** Rate limit toàn cục (security.md §6.4) — sau body parser, trước route. */
  rateLimit?: readonly RequestHandler[];
  /** Router của từng module, gắn dưới `/api/v1` + `path` (vd `/auth`, `/workspaces`). */
  routers?: readonly { path: string; router: Router }[];
  /** Một router gắn thẳng dưới `/api/v1` (test). */
  apiRouter?: Router;
}

/**
 * Composition root của HTTP (ADR-016): mọi phụ thuộc được truyền vào, không singleton.
 * Thứ tự middleware theo security.md §6.1.
 */
export function createApp(deps: AppDependencies): Express {
  const { config, logger, clock } = deps;
  const responder = deps.responder ?? new HttpResponder(clock);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);

  app.use(requestLogging(logger));
  app.use(securityHeaders({ corsOrigins: config.corsOrigins, hsts: config.hsts }));
  app.use(
    healthRouter({
      gitSha: config.gitSha,
      probes: deps.probes,
      isShuttingDown: deps.isShuttingDown,
    }),
  );
  app.use(requireJsonContentType);
  app.use(jsonBody(config.bodyLimit));
  if (deps.rateLimit?.length) app.use(...deps.rateLimit);
  for (const { path, router } of deps.routers ?? []) app.use(`/api/v1${path}`, router);
  if (deps.apiRouter) app.use('/api/v1', deps.apiRouter);

  app.use(notFoundHandler);
  app.use(globalErrorHandler({ responder, logger, exposeInternalErrors: !config.production }));
  return app;
}
