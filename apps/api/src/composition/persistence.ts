import type { ILogger } from '../core/logging/logger';
import { PrismaUnitOfWork, type TransactionCapable } from '../core/persistence/prisma-unit-of-work';
import type { IUnitOfWork } from '../core/persistence/unit-of-work';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { createInMemoryAuthRepositories, type AuthRepositories } from '../modules/auth/auth.module';
import {
  ValkeySessionRevocationStore,
  type ValkeyCommands,
} from '../modules/auth/infrastructure/cache/valkey-session-revocation.store';
import type { IRefreshTokenPurger } from '../modules/auth/application/ports/refresh-token-purger.port';
import { PrismaActivationTokenRepository } from '../modules/auth/infrastructure/persistence/prisma/prisma-activation-token.repository';
import { PrismaRefreshTokenRepository } from '../modules/auth/infrastructure/persistence/prisma/prisma-refresh-token.repository';
import { PrismaUserRefReader } from '../modules/auth/infrastructure/persistence/prisma/prisma-user-ref.reader';
import { PrismaUserRepository } from '../modules/auth/infrastructure/persistence/prisma/prisma-user.repository';
import type { CompanyRepositories } from '../modules/company/company.module';
import { InMemoryCompanyStore } from '../modules/company/infrastructure/in-memory/in-memory-company';
import { InMemoryHrAuditLog } from '../modules/company/infrastructure/in-memory/in-memory-hr-audit-log';
import { PrismaHrAuditLog } from '../modules/company/infrastructure/prisma/prisma-hr-audit-log';
import {
  PrismaCompany,
  PrismaCompanyMembers,
  PrismaCompanyTenureReader,
} from '../modules/company/infrastructure/prisma/prisma-company';
import { PrismaTaskAuditLogRepository } from '../modules/task/infrastructure/persistence/prisma/prisma-task-audit-log.repository';
import { PrismaTaskReadModel } from '../modules/task/infrastructure/persistence/prisma/prisma-task-read-model';
import { PrismaTaskRepository } from '../modules/task/infrastructure/persistence/prisma/prisma-task.repository';
import {
  createInMemoryNotificationStore,
  type NotificationRepositories,
} from '../modules/notifications/notifications.module';
import { PrismaNotificationStore } from '../modules/notifications/infrastructure/prisma/prisma-notification.store';
import { createInMemoryTaskRepositories, type TaskRepositories } from '../modules/task/task.module';
import {
  createInMemoryWorkspaceRepositories,
  type WorkspaceRepositories,
} from '../modules/workspace/workspace.module';
import { PrismaWorkspaceQueries } from '../modules/workspace/infrastructure/persistence/prisma/prisma-queries';
import {
  PrismaMembershipRepository,
  PrismaProjectRepository,
  PrismaWorkspaceRepository,
} from '../modules/workspace/infrastructure/persistence/prisma/prisma-repositories';
import {
  PrismaAssigneeDirectory,
  PrismaTaskProjectStore,
} from '../modules/workspace/infrastructure/persistence/prisma/prisma-task-ports';
import type { IWorkspacePurger } from '../modules/workspace/application/ports/collaborators.port';
import { InMemoryUnitOfWork } from './in-memory-unit-of-work';
import { noLeaveSummaries, notificationContextFrom } from './notification-adapters';
import {
  TaskMirroredMemberships,
  TaskMirroredProjects,
  TaskMirroredWorkspaces,
} from './task-mirrors';
import { MirroringUserRepository } from './users';
import { prismaMaintenance, type RetentionStores } from './retention-stores';
import type { StorageKind } from './persistence-guard';

export { assertPersistenceAllowed, type StorageKind } from './persistence-guard';

/** Mọi module cùng một loại lưu trữ (T-020: không chạy lai). */
const allModules = (kind: StorageKind) =>
  ({
    auth: kind,
    workspace: kind,
    task: kind,
    notifications: kind,
    company: kind,
  }) as const;

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
  /** Mốc 3.5: công ty (thành viên, nhiệm kỳ, HrAuditLog). Attendance / leave: `tsconfig.exclusions.json`. */
  company: CompanyRepositories;
  /** Chỉ bộ nhớ: bảng công ty để seed / harness (Prisma: dữ liệu ở DB). */
  companyStore?: InMemoryCompanyStore;
  /** Purger cho job bảo trì (T-033) — chỉ có ở Prisma; bộ nhớ không purge (local/test). */
  workspacePurger?: IWorkspacePurger;
  /** Dọn refresh token hết hạn (G2 S2) — chỉ có ở Prisma, như `workspacePurger`. */
  refreshTokenPurger?: IRefreshTokenPurger;
  /** Bước dọn của job retention (T-043, R27) — chỉ có ở Prisma. */
  retention?: RetentionStores;
  uow: IUnitOfWork;
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
  };

  const notificationStore = createInMemoryNotificationStore();
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
      context: notificationContextFrom({ users: task.users, leaves: noLeaveSummaries }),
    },
    company: { company: companyStore, members: companyStore, tenures: companyStore, hrAudit },
    companyStore,
    uow,
  };
}

/** Thời gian tối đa của một transaction (ms) — giữ ngắn, không gọi mạng ngoài trong transaction. */
const TRANSACTION_TIMEOUT_MS = 10_000;

/**
 * Lưu trữ thật (T-020): repository Prisma của auth + workspace dùng chung `PrismaUnitOfWork`
 * (`uow.db()`), session store trên Valkey. Repository Prisma JOIN bảng users ⇒ không cần
 * `MirroringUserRepository`.
 */
export function createPrismaPersistence(d: {
  prisma: PrismaClient;
  valkey: ValkeyCommands;
  logger: ILogger;
}): Persistence {
  // `PrismaClient.$transaction` là hàm overload (mảng | callback) nên không gán thẳng được vào
  // `TransactionCapable` (chỉ khai overload callback) — runtime đúng. Đã báo A chỉnh type ở core.
  const client = d.prisma as unknown as TransactionCapable<Prisma.TransactionClient> &
    Prisma.TransactionClient;
  const uow = new PrismaUnitOfWork<Prisma.TransactionClient>(client, d.logger, {
    timeout: TRANSACTION_TIMEOUT_MS,
  });
  const db = () => uow.db();
  const workspaceQueries = new PrismaWorkspaceQueries(db);
  const userRefs = new PrismaUserRefReader(db);
  return {
    kind: 'prisma',
    modules: allModules('prisma'),
    auth: {
      users: new PrismaUserRepository(db),
      refreshTokens: new PrismaRefreshTokenRepository(db),
      sessions: new ValkeySessionRevocationStore(d.valkey),
      activationTokens: new PrismaActivationTokenRepository(db),
    },
    workspace: {
      workspaces: new PrismaWorkspaceRepository(db),
      memberships: new PrismaMembershipRepository(db),
      projects: new PrismaProjectRepository(db),
      queries: workspaceQueries,
    },
    // Cùng `db` (một transaction) với Workspace/Auth: cấp số, khóa membership FOR SHARE, audit.
    task: {
      tasks: new PrismaTaskRepository(db),
      readModel: new PrismaTaskReadModel(db),
      projects: new PrismaTaskProjectStore(db),
      assignees: new PrismaAssigneeDirectory(db),
      users: userRefs,
      audit: new PrismaTaskAuditLogRepository(db),
    },
    // Cùng `db` ⇒ thông báo ghi trong transaction của leave / attendance / workspace (ADR-123).
    notifications: {
      store: new PrismaNotificationStore(db),
      context: notificationContextFrom({ users: userRefs, leaves: noLeaveSummaries }),
    },
    company: {
      company: new PrismaCompany(db),
      members: new PrismaCompanyMembers(db),
      tenures: new PrismaCompanyTenureReader(db),
      hrAudit: new PrismaHrAuditLog(db),
    },
    ...prismaMaintenance(db),
    uow,
  };
}
