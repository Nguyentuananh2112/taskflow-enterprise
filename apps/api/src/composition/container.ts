import { ROLE_PERMISSIONS } from '@taskflow/contracts';
import { createApp } from '../app';
import { InProcessEventBus } from '../core/events/event-bus';
import { HttpResponder } from '../core/http/envelope';
import { requireAllowedOrigin } from '../core/http/middleware';
import {
  createGlobalRateLimit,
  createRateLimits,
  type RateLimitDeps,
} from '../core/http/rate-limit/rate-limit';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import { createAuthModule } from '../modules/auth/auth.module';
import type { IRolePermissions } from '../modules/task/application/task-actor';
import { TASKS_PATH } from '../modules/task/presentation/task.routes';
import {
  NOTIFICATIONS_PATH,
  createNotificationsModule,
} from '../modules/notifications/notifications.module';
import { createCompanyModule } from '../modules/company/company.module';
import type { ICompanyAccounts } from '../modules/company';
import { companyAdminDeps, employmentCollaborators } from './company-adapters';
import { ATTENDANCE_PATH } from '../modules/attendance/presentation/attendance.routes';
import { LateApprovedLeavePort, wireAttendance } from './attendance-adapters';
import { LEAVE_PATH } from '../modules/leave/presentation/leave.routes';
import { wireLeave } from './leave-wiring';
import { createTaskModule } from '../modules/task/task.module';
import { createWorkspaceModule, type WorkspaceModule } from '../modules/workspace/workspace.module';
import { companyGatedSocketAuthenticator, socketAuthenticatorFrom } from '../core/realtime/ports';
import { LateBoundRealtime } from './late-realtime';
import { AuthUserDirectory } from './users';
import type { Container, ContainerDeps } from './container-types';

export type { Container, ContainerConfig, ContainerDeps } from './container-types';

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
    collaborators: () => employmentCollaborators({ workspace, leave, notifications, realtime }),
    ...companyAdminDeps(
      () => notifications,
      realtime,
      () => leave.employment,
      () => workspace.adminWorkspaces,
    ),
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
    // HIGH-2: loadMembership / project:join chặn người đã nghỉ việc ĐÚNG giờ `access_until`; thêm thành viên chỉ
    // người chưa có lịch nghỉ (ADR-134).
    company: {
      isActive: (userId) => company.sessionGate.isActive(userId),
      canJoinWorkspace: async (userId) =>
        (await company.members.find(userId))?.offboardLastDay === null,
    },
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
  // Chấm công (T-063). Đơn nghỉ gắn trễ: leave cần lịch của attendance + `authenticate` của auth ⇒ dựng sau, `bind`.
  const approvedLeaves = new LateApprovedLeavePort();
  const attendance = wireAttendance(
    { persistence, ids, clock: business, retentionCutoff: d.retentionCutoff },
    { company: () => company, notifications, leaves: approvedLeaves },
    { responder, limit },
  );
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
  // Nghỉ phép cấp công ty (T-064): quyền / nhiệm kỳ / audit ← company, lịch ← attendance.
  const leave = wireLeave(
    { persistence, clock: business, ids },
    {
      company: () => ({ ...company, clock: business }),
      hrAudit: () => company.hrAudit,
      attendance,
      notifications,
      auth,
    },
    { responder, limit },
  );
  approvedLeaves.bind(leave.approvedLeaves);

  // Router của module dưới `/api/v1` — trả ra ngoài để test parity OpenAPI (A2) duyệt route thật.
  const routers = [
    { path: '/auth', router: auth.router },
    ...company.routers(auth.authenticate),
    // Task TRƯỚC /workspaces: router workspace gắn authenticate + limiter cho mọi đường dẫn con ⇒
    // request task đi qua nó trước sẽ bị xác thực + đếm limiter 2 lần (audit T-028 F1).
    { path: TASKS_PATH, router: task.routes(auth.authenticate) },
    // Attendance cũng TRƯỚC /workspaces (cùng lý do với Task).
    { path: ATTENDANCE_PATH, router: attendance.routes(auth.authenticate) },
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
  const socketAuth = companyGatedSocketAuthenticator(
    socketAuthenticatorFrom(auth.authenticator),
    (userId) => company.sessionGate.isActive(userId),
  );
  return {
    app,
    auth,
    workspace,
    task,
    notifications,
    company,
    attendance,
    leave,
    socketAuth,
    realtime,
    routers,
  };
}
