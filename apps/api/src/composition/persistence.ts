import type { ILogger } from '../core/logging/logger';
import type { IReadSnapshot } from '../core/persistence/read-snapshot';
import type { IUnitOfWork } from '../core/persistence/unit-of-work';
import { createInMemoryAuthRepositories, type AuthRepositories } from '../modules/auth/auth.module';
import type { IRefreshTokenPurger } from '../modules/auth/application/ports/refresh-token-purger.port';
import {
  createInMemoryAttendanceRepositories,
  type AttendanceRepositories,
} from '../modules/attendance/attendance.module';
import type { CompanyRepositories } from '../modules/company/company.module';
import type { IAvatarDirectory } from '../modules/auth/application/ports/avatar-directory.port';
import { SystemClock } from '../core/infrastructure/system';
import { memoryAvatarDirectory } from './avatar-sweep';
import { memoryChatDirectory, memoryChatRepositories } from './chat-persistence';
import type { ChatRepositories } from '../modules/chat/chat.module';
import { InMemoryCompanyOffboarding } from '../modules/company/infrastructure/in-memory/in-memory-company-offboarding';
import { InMemoryCompanyStore } from '../modules/company/infrastructure/in-memory/in-memory-company';
import { InMemoryHrAuditLog } from '../modules/company/infrastructure/in-memory/in-memory-hr-audit-log';
import type { HrProfileRepositories } from '../modules/hr-profile/hr-profile.module';
import { InMemoryEmployeeProfiles } from '../modules/hr-profile/infrastructure/in-memory/in-memory-employee-profiles';
import type { LeaveRepositories } from '../modules/leave/leave.module';
import { InMemoryLeavePolicyStore } from '../modules/leave/infrastructure/persistence/in-memory/in-memory-leave-policy.store';
import { InMemoryLeaveRepository } from '../modules/leave/infrastructure/persistence/in-memory/in-memory-leave.repository';
import {
  createInMemoryNotificationStore,
  type NotificationRepositories,
} from '../modules/notifications/notifications.module';
import { createInMemoryTaskRepositories, type TaskRepositories } from '../modules/task/task.module';
import {
  createInMemoryWorkspaceRepositories,
  type WorkspaceRepositories,
} from '../modules/workspace/workspace.module';
import type { IWorkspacePurger } from '../modules/workspace/application/ports/collaborators.port';
import { InMemoryMemberCandidates } from '../modules/workspace/infrastructure/persistence/in-memory/in-memory-member-candidates';
import { InMemoryUnitOfWork } from './in-memory-unit-of-work';
import { memoryLeaveRepositories } from './leave-adapters';
import { notificationContextFrom } from './notification-adapters';
import {
  TaskMirroredMemberships,
  TaskMirroredProjects,
  TaskMirroredWorkspaces,
} from './task-mirrors';
import { MirroringUserRepository } from './users';
import { type RetentionStores } from './retention-stores';
import { allModules, type StorageKind } from './persistence-guard';

export { assertPersistenceAllowed, type StorageKind } from './persistence-guard';

export interface Persistence {
  kind: StorageKind;
  /** Lưu trữ thực của TỪNG module đã wire — guard production xét theo đây (T-020). */
  modules: Readonly<Record<string, StorageKind>>;
  auth: AuthRepositories;
  workspace: WorkspaceRepositories;
  /** Module Task: Prisma (T-023) hoặc bộ nhớ có bản sao dữ liệu Workspace/Auth (T-024). */
  task: TaskRepositories;
  /**
   * Thông báo bền (ADR-123) — store ghi trong cùng UoW; context chỉ đọc. Audience = tư cách công ty ⇒ container
   * lấy từ module company (Mốc 3.5).
   */
  notifications: Omit<NotificationRepositories, 'audience'>;
  /** Mốc 3.5: công ty (thành viên, nhiệm kỳ, HrAuditLog). */
  company: CompanyRepositories;
  /** Chấm công cấp công ty (T-063): lượt chấm + lịch / ngày lễ. */
  attendance: AttendanceRepositories;
  /** Module leave (T-039/T-064): đơn nghỉ + số dư + phía đọc + danh bạ nhân viên. */
  leave: LeaveRepositories;
  /** Hồ sơ nhân viên (Mốc 5, T-054). */
  hrProfile: HrProfileRepositories;
  /** Chỉ bộ nhớ: bảng công ty để seed / harness (Prisma: dữ liệu ở DB). */
  companyStore?: InMemoryCompanyStore;
  /** Purger cho job bảo trì (T-033) — chỉ có ở Prisma; bộ nhớ không purge (local/test). */
  workspacePurger?: IWorkspacePurger;
  /** Dọn refresh token hết hạn (G2 S2) — chỉ có ở Prisma, như `workspacePurger`. */
  refreshTokenPurger?: IRefreshTokenPurger;
  /** Bước dọn của job retention (T-043, R27) — chỉ có ở Prisma. */
  retention?: RetentionStores;
  /** Mốc 6 (T-068): avatar theo lô — hiển thị, `/media`, sweep. */
  avatarDirectory: IAvatarDirectory;
  /** Mốc 6 (T-069): trò chuyện — store của D (T-069a). */
  chat: ChatRepositories;
  /** `snapshot`: ảnh chụp đọc REPEATABLE READ READ ONLY cho báo cáo .xlsx (ADR-130, T-055y). */
  uow: IUnitOfWork & { snapshot: IReadSnapshot };
}

/** Lưu trữ trong bộ nhớ — chỉ local/test, MẤT DỮ LIỆU khi khởi động lại. */
export function createMemoryPersistence(logger: ILogger): Persistence {
  const auth = createInMemoryAuthRepositories();
  const ws = createInMemoryWorkspaceRepositories();
  const task = createInMemoryTaskRepositories();
  const companyStore = new InMemoryCompanyStore();
  const hrAudit = new InMemoryHrAuditLog((id) => ws.directory.users.get(id)?.fullName);

  // Bản sao của Workspace/Auth trong InMemoryTaskDatabase (Prisma đọc bảng chung nên không cần).
  const users = new MirroringUserRepository(auth.users, ws.directory, (user) => {
    task.db.state.users.set(user.id, {
      id: user.id,
      fullName: user.fullName,
      deletedAt: user.toSnapshot().deletedAt,
    });
  });
  const workspace: WorkspaceRepositories = {
    workspaces: new TaskMirroredWorkspaces(ws.workspaces, task.db),
    memberships: new TaskMirroredMemberships(ws.memberships, task.db),
    projects: new TaskMirroredProjects(ws.projects, task.db),
    queries: ws.queries,
    candidates: new InMemoryMemberCandidates(companyStore, ws.directory, ws.memberships),
  };

  const notificationStore = createInMemoryNotificationStore();
  const attendance = createInMemoryAttendanceRepositories();
  const leaveStore = new InMemoryLeaveRepository();
  const profiles = new InMemoryEmployeeProfiles();
  const leavePolicies = new InMemoryLeavePolicyStore();
  const leave = memoryLeaveRepositories(
    leaveStore,
    leavePolicies,
    companyStore,
    task.db.state.users,
  );
  const chat = memoryChatRepositories(
    memoryChatDirectory({
      members: companyStore,
      users,
      workspaces: ws.workspaces,
      memberships: ws.memberships,
    }),
  );
  const uow = new InMemoryUnitOfWork(
    [
      auth.users,
      auth.refreshTokens,
      auth.activationTokens,
      ws.workspaces,
      ws.memberships,
      ws.projects,
      task.db,
      notificationStore,
      companyStore,
      hrAudit,
      attendance.events,
      attendance.calendar,
      attendance.corrections,
      leaveStore,
      profiles,
      leavePolicies,
      chat.state,
    ],
    logger,
  );
  return {
    kind: 'memory',
    modules: allModules('memory'),
    auth: {
      users,
      refreshTokens: auth.refreshTokens,
      sessions: auth.sessions,
      activationTokens: auth.activationTokens,
    },
    workspace,
    task,
    notifications: {
      store: notificationStore,
      context: notificationContextFrom({ users: task.users, leaves: leave.readModel }),
    },
    company: {
      company: companyStore,
      members: companyStore,
      tenures: companyStore,
      hrAudit,
      offboarding: new InMemoryCompanyOffboarding(companyStore),
    },
    companyStore,
    attendance,
    leave,
    hrProfile: { profiles, locks: profiles },
    avatarDirectory: memoryAvatarDirectory(users, companyStore, new SystemClock()),
    chat: chat.repos,
    uow,
  };
}
