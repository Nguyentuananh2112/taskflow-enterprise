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
import { createWorkspaceModule, type WorkspaceModule } from '../modules/workspace/workspace.module';
import { LateBoundRealtime } from './late-realtime';
import type { Persistence } from './persistence';
import { AuthUserDirectory } from './users';

export interface ContainerConfig extends AppConfig {
  cookieSecure: boolean;
  jwtSecret: string;
  jwtPreviousSecret?: string | undefined;
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
}

export interface Container {
  app: Express;
  auth: AuthModule;
  workspace: WorkspaceModule;
  /** Gắn gateway Socket.io sau khi có HTTP server: `realtime.bind(gateway)`. */
  realtime: LateBoundRealtime;
}

/** TODO(T-018): module Task hiện thực bỏ gán khi hạ VIEWER / xóa thành viên (ADR-044). */
const noTaskModuleYet = {
  unassignAllForUser: () => Promise.resolve({ unassignedTaskCount: 0 }),
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

  const workspace = createWorkspaceModule({
    repos: persistence.workspace,
    users: new AuthUserDirectory(persistence.auth.users),
    notifier: realtime,
    cleaner: noTaskModuleYet,
    uow: persistence.uow,
    ids,
    clock,
    random,
    logger,
    responder,
    limit,
  });
  const auth = createAuthModule({
    repos: persistence.auth,
    hasher: d.hasher,
    policy: d.policy,
    jwt: { secret: config.jwtSecret, previousSecret: config.jwtPreviousSecret },
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
    routers: [
      { path: '/auth', router: auth.router },
      { path: '/workspaces', router: workspace.routes(auth.authenticate) },
    ],
  });
  return { app, auth, workspace, realtime };
}
