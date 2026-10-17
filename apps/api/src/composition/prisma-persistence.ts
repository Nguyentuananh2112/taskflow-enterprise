import type { ILogger } from '../core/logging/logger';
import { PrismaUnitOfWork, type TransactionCapable } from '../core/persistence/prisma-unit-of-work';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import {
  ValkeySessionRevocationStore,
  type ValkeyCommands,
} from '../modules/auth/infrastructure/cache/valkey-session-revocation.store';
import { PrismaActivationTokenRepository } from '../modules/auth/infrastructure/persistence/prisma/prisma-activation-token.repository';
import { PrismaRefreshTokenRepository } from '../modules/auth/infrastructure/persistence/prisma/prisma-refresh-token.repository';
import { PrismaUserRefReader } from '../modules/auth/infrastructure/persistence/prisma/prisma-user-ref.reader';
import { PrismaUserRepository } from '../modules/auth/infrastructure/persistence/prisma/prisma-user.repository';
import { createPrismaAttendanceRepositories } from '../modules/attendance/attendance.module';
import { PrismaHrAuditLog } from '../modules/company/infrastructure/prisma/prisma-hr-audit-log';
import { PrismaCompanyOffboarding } from '../modules/company/infrastructure/prisma/prisma-company-offboarding';
import {
  PrismaCompany,
  PrismaCompanyMembers,
  PrismaCompanyTenureReader,
} from '../modules/company/infrastructure/prisma/prisma-company';
import { PrismaTaskAuditLogRepository } from '../modules/task/infrastructure/persistence/prisma/prisma-task-audit-log.repository';
import { PrismaTaskReadModel } from '../modules/task/infrastructure/persistence/prisma/prisma-task-read-model';
import { PrismaTaskRepository } from '../modules/task/infrastructure/persistence/prisma/prisma-task.repository';
import { PrismaNotificationStore } from '../modules/notifications/infrastructure/prisma/prisma-notification.store';
import { PrismaMemberCandidates } from '../modules/workspace/infrastructure/persistence/prisma/prisma-member-candidates';
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
import { PrismaEmployeeProfiles } from '../modules/hr-profile/infrastructure/prisma/prisma-employee-profiles';
import { prismaLeaveRepositories } from './leave-adapters';
import { notificationContextFrom } from './notification-adapters';
import { prismaMaintenance } from './retention-stores';
import { allModules } from './persistence-guard';
import type { Persistence } from './persistence';

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
  const leave = prismaLeaveRepositories(db);
  const profiles = new PrismaEmployeeProfiles(db);
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
      candidates: new PrismaMemberCandidates(db),
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
      context: notificationContextFrom({ users: userRefs, leaves: leave.readModel }),
    },
    company: {
      company: new PrismaCompany(db),
      members: new PrismaCompanyMembers(db),
      tenures: new PrismaCompanyTenureReader(db),
      hrAudit: new PrismaHrAuditLog(db),
      offboarding: new PrismaCompanyOffboarding(db),
    },
    attendance: createPrismaAttendanceRepositories(db),
    leave,
    hrProfile: { profiles, locks: profiles },
    ...prismaMaintenance(db),
    uow,
    readSnapshot: uow.snapshot,
  };
}
