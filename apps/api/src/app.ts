import express, { type Express, type RequestHandler, type Router } from 'express';
import type { Logger } from 'pino';

import { isDeployed, type Env } from './config/env';
import type { IClock } from './core/domain';
import { HttpResponder } from './core/http/envelope';
import { globalErrorHandler, notFoundHandler } from './core/http/error-handler';
import { markRouteBase, type AppMetrics } from './core/observability/metrics';
import type { IErrorReporter } from './core/observability/sentry';
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
  /** Ẩn chi tiết lỗi 500 — `APP_ENV ∈ {staging, production}` (L1 của T-028, không theo NODE_ENV). */
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
    production: isDeployed(env.APP_ENV),
    hsts: isDeployed(env.APP_ENV),
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
  /** Metrics Prometheus (T-035) — đo theo MẪU route; endpoint `/metrics` ở cổng nội bộ riêng. */
  metrics?: AppMetrics;
  /** Báo lỗi 5xx ra Sentry (T-035). */
  errorReporter?: IErrorReporter;
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
  if (deps.metrics) app.use(deps.metrics.httpMetrics());
  app.use(securityHeaders({ corsOrigins: config.corsOrigins, hsts: config.hsts }));
  app.use(
    healthRouter({
      now: () => clock.now().getTime(),
      probes: deps.probes,
      isShuttingDown: deps.isShuttingDown,
    }),
  );
  app.use(requireJsonContentType);
  app.use(jsonBody(config.bodyLimit));
  // L4 của T-028: mặc định KHÔNG cache mọi response API (dữ liệu có xác thực, PII như email thành
  // viên). Route muốn cho cache tự đặt lại header sau middleware này.
  app.use('/api/v1', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  if (deps.rateLimit?.length) app.use(...deps.rateLimit);
  for (const { path, router } of deps.routers ?? []) {
    app.use(`/api/v1${path}`, markRouteBase(`/api/v1${path}`), router);
  }
  if (deps.apiRouter) app.use('/api/v1', markRouteBase('/api/v1'), deps.apiRouter);

  app.use(notFoundHandler);
  app.use(
    globalErrorHandler({
      responder,
      logger,
      exposeInternalErrors: !config.production,
      ...(deps.errorReporter ? { reporter: deps.errorReporter } : {}),
    }),
  );
  return app;
}
