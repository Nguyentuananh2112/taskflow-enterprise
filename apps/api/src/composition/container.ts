import { ROLE_PERMISSIONS, hasPermission } from '@taskflow/contracts';
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
import {
  createAttendanceModule,
  type AttendanceModule,
} from '../modules/attendance/attendance.module';
import { ATTENDANCE_PATH } from '../modules/attendance/presentation/attendance.routes';
import { createAuthModule, type AuthModule } from '../modules/auth/auth.module';
import type { IAccessTokenService } from '../modules/auth/application/ports/access-token-service.port';
import type { IPasswordHasher } from '../modules/auth/application/ports/password-hasher.port';
import type { PasswordPolicy } from '../modules/auth/domain/password-policy';
import type { IRolePermissions } from '../modules/task/application/task-actor';
import { createLeaveModule } from '../modules/leave/leave.module';
import { LEAVE_PATH } from '../modules/leave/presentation/leave.routes';
import { TASKS_PATH } from '../modules/task/presentation/task.routes';
import {
  NOTIFICATIONS_PATH,
  createNotificationsModule,
  type NotificationsModule,
} from '../modules/notifications/notifications.module';
import { createTaskModule, type TaskModule } from '../modules/task/task.module';
import { createWorkspaceModule, type WorkspaceModule } from '../modules/workspace/workspace.module';
import type { AppMetrics } from '../core/observability/metrics';
import type { IErrorReporter } from '../core/observability/sentry';
import { attendanceMembership, noApprovedLeaves } from './attendance-adapters';
import { LateBoundRealtime } from './late-realtime';
import { defaultLeaveCalendar, leaveAudit, leaveMembership } from './leave-adapters';
import type { Persistence } from './persistence';
import {
  attendanceNotifierFrom,
  hrGrantNotifierFrom,
  leaveNotifierFrom,
} from './notification-adapters';
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
  /** Thông báo bền (ADR-123): `publisher` nối vào port của leave / attendance / workspace. */
  notifications: NotificationsModule;
  attendance: AttendanceModule;
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
  // Trước Workspace: publisher là port ghi thông báo (cùng UoW) cho Workspace / leave / attendance.
  const notifications = createNotificationsModule({
    repos: persistence.notifications,
    // B-H3b: quyền hiệu lực role ∪ grants đọc từ DB mỗi lần (audience), cùng ma trận với contracts.
    canManageHr: (role, grants) => hasPermission(role, grants, 'hr:manage'),
    realtime,
    uow: persistence.uow,
    ids,
    clock,
    responder,
    limit,
  });
  const workspace = createWorkspaceModule({
    repos: persistence.workspace,
    users: new AuthUserDirectory(persistence.auth.users),
    notifier: realtime,
    hrNotifier: hrGrantNotifierFrom(notifications.publisher),
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
  const attendance = createAttendanceModule({
    repos: persistence.attendance,
    leaves: noApprovedLeaves, // TODO(T-039): leave.approvedLeaves (D nối, tham chiếu trễ)
    tenures: workspace.tenure,
    users: persistence.task.users,
    hrAccess: workspace.hrAccess,
    audit: workspace.hrAudit,
    notifier: attendanceNotifierFrom(notifications.publisher),
    membership: attendanceMembership(() => workspace),
    uow: persistence.uow,
    clock,
    ids,
    responder,
    limit,
  });
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

  const leave = createLeaveModule({
    ...persistence.leave,
    users: persistence.task.users,
    calendar: defaultLeaveCalendar, // TODO(T-038): adapter WorkCalendarPort của attendance (A)
    notifier: leaveNotifierFrom(notifications.publisher),
    membership: leaveMembership(() => workspace),
    audit: leaveAudit(() => workspace),
    uow: persistence.uow,
    clock,
    ids,
    responder,
    http: { authenticate: auth.authenticate, limit },
  });

  // Router của module dưới `/api/v1` — trả ra ngoài để test parity OpenAPI (A2) duyệt route thật.
  const routers = [
    { path: '/auth', router: auth.router },
    // Task TRƯỚC /workspaces: router workspace gắn authenticate + limiter cho mọi đường dẫn con ⇒
    // request task đi qua nó trước sẽ bị xác thực + đếm limiter 2 lần (audit T-028 F1).
    { path: TASKS_PATH, router: task.routes(auth.authenticate) },
    // Attendance cũng TRƯỚC /workspaces (cùng lý do với Task).
    { path: ATTENDANCE_PATH, router: attendance.routes(auth.authenticate) },
    // Leave cũng TRƯỚC /workspaces (cùng lý do với Task).
    { path: LEAVE_PATH, router: leave.router },
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
  return { app, auth, workspace, task, notifications, attendance, realtime, routers };
}
