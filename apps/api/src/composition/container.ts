import { ROLE_PERMISSIONS } from '@taskflow/contracts';
import type { Store } from 'express-rate-limit';
import type { Express, Router } from 'express';
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
import {
  NOTIFICATIONS_PATH,
  createNotificationsModule,
  type NotificationsModule,
} from '../modules/notifications/notifications.module';
import { createCompanyModule, type CompanyModule } from '../modules/company/company.module';
import type { ICompanyAccounts } from '../modules/company';
import { HR_PATH } from '../modules/company/presentation/hr.routes';
import { createTaskModule, type TaskModule } from '../modules/task/task.module';
import { createWorkspaceModule, type WorkspaceModule } from '../modules/workspace/workspace.module';
import type { AppMetrics } from '../core/observability/metrics';
import type { IErrorReporter } from '../core/observability/sentry';
import {
  companyGatedSocketAuthenticator,
  socketAuthenticatorFrom,
  type ISocketAuthenticator,
} from '../core/realtime/ports';
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
  /**
   * Giờ NGHIỆP VỤ (attendance, leave, notifications, workspace — workDate, "hôm nay", serverNow, createdAt, joinedAt /
   * leftAt của nhiệm kỳ). Thiếu ⇒ `clock`. Chỉ E2E đặt khác (TEST_CLOCK_ANCHOR, APP_ENV=test — anchored-clock.ts);
   * auth/JWT, task, rate limit, meta.timestamp, socket luôn theo `clock` (giờ thật).
   */
  businessClock?: IClock;
  /**
   * T-047: mốc lưu dữ liệu chấm công (`YYYY-MM-DD`) — `retentionCutoffFor` của maintenance-setup, CHỈ khác null khi job
   * retention thật sự bật. Thiếu ⇒ không áp (test HTTP, chế độ bộ nhớ).
   */
  retentionCutoff?: () => string | null;
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
  /** Thông báo bền (ADR-123): `publisher` nối vào port của leave / attendance / workspace. */
  notifications: NotificationsModule;
  /** Mốc 3.5: công ty — quyền / nhiệm kỳ / HrAuditLog cho attendance, leave, payroll (nối khi gỡ loại tạm). */
  company: CompanyModule;
  /** Authenticator của gateway Socket.io: access token (auth) + cổng công ty (HIGH-2). */
  socketAuth: ISocketAuthenticator;
  /** Gắn gateway Socket.io sau khi có HTTP server: `realtime.bind(gateway)`. */
  realtime: LateBoundRealtime;
  /** Router module gắn dưới `/api/v1` + đường dẫn gắn — cho test parity OpenAPI (A2). */
  routers: readonly { path: string; router: Router }[];
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
  const business = d.businessClock ?? clock;
  // meta.timestamp của MỌI envelope theo giờ nghiệp vụ: web suy độ lệch giờ server từ đó (E).
  const responder = new HttpResponder(business);
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
  // Mốc 3.5 (ADR-133…137): quyền công ty đọc DB mỗi lần, `access_until` theo giờ nghiệp vụ (R31).
  // Auth cần cổng công ty; company cần tài khoản của auth (thêm nhân viên) ⇒ tham chiếu trễ một chiều.
  const accountsRef: { current: ICompanyAccounts | null } = { current: null };
  const company = createCompanyModule({
    repos: persistence.company,
    ids,
    clock: business,
    uow: persistence.uow,
    logger,
    responder,
    limit,
    accounts: accountsRef,
  });
  // Trước Workspace: publisher là port ghi thông báo (cùng UoW) cho leave / attendance / company.
  const notifications = createNotificationsModule({
    // B-H3b: người nhận / phạm vi xem theo quyền công ty HIỆN TẠI (audience của module company).
    repos: { ...persistence.notifications, audience: company.notificationAudience },
    realtime,
    uow: persistence.uow,
    ids,
    clock: business,
    responder,
    limit,
  });
  const workspace = createWorkspaceModule({
    repos: persistence.workspace,
    users: new AuthUserDirectory(persistence.auth.users),
    notifier: realtime,
    // HIGH-2: loadMembership / project:join chặn người đã nghỉ việc ĐÚNG giờ `access_until`.
    company: company.sessionGate,
    cleaner: task.cleaner,
    uow: persistence.uow,
    ids,
    clock: business,
    random,
    logger,
    responder,
    limit,
  });
  workspaceRef.current = workspace;
  // TẠM (T-061, `tsconfig.exclusions.json`): attendance (A, T-063) / leave (D, T-064) chưa dựng — gỡ khi rebase.
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
    memberships: workspace.membershipReader,
    company: company.sessionGate,
    // Link kích hoạt `<web>/activate#t=…` — origin web đầu tiên của CORS (production: đúng một).
    webOrigin: config.corsOrigins[0] ?? 'http://localhost:3001',
    notifier: realtime,
    uow: persistence.uow,
    events,
    ids,
    clock,
    activationClock: business,
    logger,
    responder,
    limit,
    ...(d.accessTokens ? { accessTokens: d.accessTokens } : {}),
  });
  accountsRef.current = auth.accounts;

  // Router của module dưới `/api/v1` — trả ra ngoài để test parity OpenAPI (A2) duyệt route thật.
  const routers = [
    { path: '/auth', router: auth.router },
    { path: HR_PATH, router: company.hrRoutes(auth.authenticate) },
    // Task TRƯỚC /workspaces: router workspace gắn authenticate + limiter cho mọi đường dẫn con ⇒
    // request task đi qua nó trước sẽ bị xác thực + đếm limiter 2 lần (audit T-028 F1).
    { path: TASKS_PATH, router: task.routes(auth.authenticate) },
    { path: '/workspaces', router: workspace.routes(auth.authenticate) },
    { path: NOTIFICATIONS_PATH, router: notifications.routes(auth.authenticate) },
  ];
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
    routers,
  });
  const socketAuth = companyGatedSocketAuthenticator(
    socketAuthenticatorFrom(auth.authenticator),
    (userId) => company.sessionGate.isActive(userId),
  );
  return { app, auth, workspace, task, notifications, company, socketAuth, realtime, routers };
}
