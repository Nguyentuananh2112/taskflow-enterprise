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
import { createNotificationsModule } from '../modules/notifications/notifications.module';
import { createCompanyModule } from '../modules/company/company.module';
import type { ICompanyAccounts } from '../modules/company';
import { companyAdminDeps, employmentCollaborators, workspaceGate } from './company-adapters';
import { attendanceShared, wireAttendance } from './attendance-adapters';
import { wireLeaveAndProfile } from './hr-wiring';
import { wirePayroll } from './payroll-wiring';
import { apiRouters } from './api-routers';
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
    // ADR-120: ngày công / access_until theo múi giờ lịch công ty (attendance dựng sau ⇒ đọc trễ lúc chạy).
    timeZone: () => attendance.timeZoneNow(),
    ids,
    clock: business,
    uow: persistence.uow,
    logger,
    responder,
    limit,
    accounts: accountsRef,
    collaborators: () =>
      employmentCollaborators({ workspace, leave, attendance, notifications, realtime, hrProfile }),
    ...companyAdminDeps(
      () => notifications,
      realtime,
      () => ({ employment: leave.employment, attendance }),
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
    company: workspaceGate(company),
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
  const { approvedLeaves, exportSlots } = attendanceShared();
  const attendance = wireAttendance(
    { persistence, ids, clock: business, retentionCutoff: d.retentionCutoff },
    { company: () => company, notifications, leaves: approvedLeaves },
    { responder, limit, exports: { limits: config.exportLimits, slots: exportSlots } },
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
  // Nghỉ phép (T-064/T-057) + hồ sơ (T-054) — phụ thuộc vòng (ngày vào ↔ phép âm) ⇒ dựng chung (hr-wiring.ts).
  const { leave, hrProfile } = wireLeaveAndProfile(
    { persistence, clock: business, ids, logger },
    {
      company,
      attendance,
      notifications,
      auth,
      // Cùng bộ suất với bảng công (attendanceShared — SEC-HR-54) + cùng trần T-055.
      exportSlots,
      exportLimits: config.exportLimits,
    },
    { responder, limit },
  );
  approvedLeaves.bind(leave.approvedLeaves);
  // Lương (Mốc 4, T-049): quyền / audit ← company, công ← attendance, `hireDate` ← hồ sơ (ADR-128).
  const payroll = wirePayroll(
    { persistence, clock: business, ids },
    { company, attendance, hrProfile, notifications },
    { responder, limit },
  );

  // Router của module dưới `/api/v1` — trả ra ngoài để test parity OpenAPI (A2) duyệt route thật.
  const routers = apiRouters({
    auth,
    company,
    hrProfile,
    payroll,
    task,
    attendance,
    leave,
    workspace,
    notifications,
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
    payroll,
    attendance,
    leave,
    socketAuth,
    realtime,
    routers,
  };
}
