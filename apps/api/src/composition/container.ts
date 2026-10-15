import { ROLE_PERMISSIONS } from '@taskflow/contracts';
import type { Store } from 'express-rate-limit';
import type { Express } from 'express';
import type { Logger } from 'pino';

import { createApp, type AppConfig } from '../app';
import type { IClock, IIdGenerator, IRandom } from '../core/domain';
import { InProcessEventBus } from '../core/events/event-bus';
import { HttpResponder } from '../core/http/envelope';
import type { ReadinessProbe } from '../core/http/health';
import { requireAllowedOrigin } from '../core/http/middleware';
import {
  createGlobalRateLimit,
  createRateLimits,
  type RateLimitDeps,
} from '../core/http/rate-limit/rate-limit';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import { createAuthModule, type AuthModule } from '../modules/auth/auth.module';
import type { IAccessTokenService } from '../modules/auth/application/ports/access-token-service.port';
import type { IPasswordHasher } from '../modules/auth/application/ports/password-hasher.port';
import type { PasswordPolicy } from '../modules/auth/domain/password-policy';
import type { IRolePermissions } from '../modules/task/application/task-actor';
import { TASKS_PATH } from '../modules/task/presentation/task.routes';
import { createTaskModule, type TaskModule } from '../modules/task/task.module';
import { createWorkspaceModule, type WorkspaceModule } from '../modules/workspace/workspace.module';
import type { AppMetrics } from '../core/observability/metrics';
import type { IErrorReporter } from '../core/observability/sentry';
import { LateBoundRealtime } from './late-realtime';
import type { Persistence } from './persistence';
import { AuthUserDirectory } from './users';

export interface ContainerConfig extends AppConfig {
  cookieSecure: boolean;
  jwtSecret: string;
  jwtPreviousSecret?: string | undefined;
  /** Chỉ APP_ENV=test (env.ts chặn nơi khác); thiếu ⇒ 900 giây. */
  jwtAccessTtlSeconds?: number | undefined;
}

export interface ContainerDeps {
  config: ContainerConfig;
  logger: Logger;
  clock: IClock;
  ids: IIdGenerator;
  random: IRandom;
  hasher: IPasswordHasher;
  policy: PasswordPolicy;
  persistence: Persistence;
  /** Store rate limit cho từng rule (Valkey ở production — ADR-063; bộ nhớ trong test). */
  rateLimitStore: (rule: RateLimitRule) => Store;
  probes: readonly ReadinessProbe[];
  isShuttingDown: () => boolean;
  accessTokens?: IAccessTokenService;
  /** Observability (T-035) — thiếu ⇒ không đo / không báo Sentry (test). */
  metrics?: AppMetrics;
  errorReporter?: IErrorReporter;
}

export interface Container {
  app: Express;
  auth: AuthModule;
  workspace: WorkspaceModule;
  task: TaskModule;
  /** Gắn gateway Socket.io sau khi có HTTP server: `realtime.bind(gateway)`. */
  realtime: LateBoundRealtime;
}

/** Ma trận quyền dùng chung (contracts) — nguồn của `IRolePermissions` cho module Task. */
const rolePermissions: IRolePermissions = {
  allows: (role, permission) => ROLE_PERMISSIONS[role].includes(permission),
};

/**
 * Composition root (ADR-016): wire mọi module với nhau qua port (ADR-093) và gắn router vào app.
 * Dùng chung cho `main.ts` (production/dev) và test HTTP (InMemory, store rate limit bộ nhớ).
 */
export function createContainer(d: ContainerDeps): Container {
  const { config, logger, clock, ids, random, persistence } = d;
  const responder = new HttpResponder(clock);
  const events = new InProcessEventBus(logger);
  const realtime = new LateBoundRealtime();
  const rateLimitDeps: RateLimitDeps = {
    storeFor: d.rateLimitStore,
    logger,
    userIdOf: (req) => req.user?.id,
  };
  const limit = (rules: readonly RateLimitRule[]) => createRateLimits(rules, rateLimitDeps);

  // Task cần membership của Workspace, Workspace cần cleaner của Task ⇒ tham chiếu trễ một chiều.
  const workspaceRef: { current?: WorkspaceModule } = {};
  const task = createTaskModule({
    repos: persistence.task,
    permissions: rolePermissions,
    notifier: realtime,
    membership: {
      resolveActor: (workspaceId, userId) => {
        if (!workspaceRef.current) throw new Error('workspace module chưa được tạo');
        return workspaceRef.current.access.resolveActor(workspaceId, userId);
      },
    },
    events,
    uow: persistence.uow,
    clock,
    ids,
    logger,
    responder,
    limit,
  });
  const workspace = createWorkspaceModule({
    repos: persistence.workspace,
    users: new AuthUserDirectory(persistence.auth.users),
    notifier: realtime,
    cleaner: task.cleaner,
    uow: persistence.uow,
    ids,
    clock,
    random,
    logger,
    responder,
    limit,
  });
  workspaceRef.current = workspace;
  const auth = createAuthModule({
    repos: persistence.auth,
    hasher: d.hasher,
    policy: d.policy,
    jwt: {
      secret: config.jwtSecret,
      previousSecret: config.jwtPreviousSecret,
      ttlSeconds: config.jwtAccessTtlSeconds,
    },
    cookieSecure: config.cookieSecure,
    requireAllowedOrigin: requireAllowedOrigin(config.corsOrigins),
    provisioner: workspace.provisioner,
    memberships: workspace.membershipReader,
    notifier: realtime,
    uow: persistence.uow,
    events,
    ids,
    clock,
    logger,
    responder,
    limit,
    ...(d.accessTokens ? { accessTokens: d.accessTokens } : {}),
  });

  const app = createApp({
    config,
    logger,
    clock,
    responder,
    probes: d.probes,
    isShuttingDown: d.isShuttingDown,
    rateLimit: createGlobalRateLimit(rateLimitDeps),
    ...(d.metrics ? { metrics: d.metrics } : {}),
    ...(d.errorReporter ? { errorReporter: d.errorReporter } : {}),
    routers: [
      { path: '/auth', router: auth.router },
      // Task TRƯỚC /workspaces: router workspace gắn authenticate + limiter cho mọi đường dẫn con ⇒
      // request task đi qua nó trước sẽ bị xác thực + đếm limiter 2 lần (audit T-028 F1).
      { path: TASKS_PATH, router: task.routes(auth.authenticate) },
      { path: '/workspaces', router: workspace.routes(auth.authenticate) },
    ],
  });
  return { app, auth, workspace, task, realtime };
}
