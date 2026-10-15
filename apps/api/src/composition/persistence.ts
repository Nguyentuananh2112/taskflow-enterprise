import type { ILogger } from '../core/logging/logger';
import { PrismaUnitOfWork, type TransactionCapable } from '../core/persistence/prisma-unit-of-work';
import type { IUnitOfWork } from '../core/persistence/unit-of-work';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { createInMemoryAuthRepositories, type AuthRepositories } from '../modules/auth/auth.module';
import {
  ValkeySessionRevocationStore,
  type ValkeyCommands,
} from '../modules/auth/infrastructure/cache/valkey-session-revocation.store';
import { PrismaRefreshTokenRepository } from '../modules/auth/infrastructure/persistence/prisma/prisma-refresh-token.repository';
import { PrismaUserRepository } from '../modules/auth/infrastructure/persistence/prisma/prisma-user.repository';
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
import { InMemoryUnitOfWork } from './in-memory-unit-of-work';
import { MirroringUserRepository } from './users';

export type StorageKind = 'memory' | 'prisma';

export interface Persistence {
  kind: StorageKind;
  /** Lưu trữ thực của TỪNG module đã wire — guard production xét theo đây (T-020). */
  modules: Readonly<Record<string, StorageKind>>;
  auth: AuthRepositories;
  workspace: WorkspaceRepositories;
  uow: IUnitOfWork;
}

/** Lưu trữ trong bộ nhớ — chỉ local/test, MẤT DỮ LIỆU khi khởi động lại. */
export function createMemoryPersistence(logger: ILogger): Persistence {
  const auth = createInMemoryAuthRepositories();
  const ws = createInMemoryWorkspaceRepositories();
  const users = new MirroringUserRepository(auth.users, ws.directory);
  const uow = new InMemoryUnitOfWork(
    [auth.users, auth.refreshTokens, ws.workspaces, ws.memberships, ws.projects],
    logger,
  );
  return {
    kind: 'memory',
    modules: { auth: 'memory', workspace: 'memory' },
    auth: { users, refreshTokens: auth.refreshTokens, sessions: auth.sessions },
    workspace: ws,
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
  return {
    kind: 'prisma',
    modules: { auth: 'prisma', workspace: 'prisma' },
    auth: {
      users: new PrismaUserRepository(db),
      refreshTokens: new PrismaRefreshTokenRepository(db),
      sessions: new ValkeySessionRevocationStore(d.valkey),
    },
    workspace: {
      workspaces: new PrismaWorkspaceRepository(db),
      memberships: new PrismaMembershipRepository(db),
      projects: new PrismaProjectRepository(db),
      queries: new PrismaWorkspaceQueries(db),
    },
    uow,
  };
}

/**
 * Quyết định Tech Lead (T-020): staging/production từ chối khởi động nếu BẤT KỲ module nào chạy
 * bộ nhớ (kể cả trạng thái "lai"). Local/test: trả danh sách module đang chạy bộ nhớ để cảnh báo.
 * Kiểm theo module THỰC SỰ đã wire (không chỉ theo biến môi trường) — module mới (Task — T-024)
 * phải khai `modules.task`.
 */
export function assertPersistenceAllowed(
  appEnv: 'local' | 'test' | 'staging' | 'production',
  modules: Readonly<Record<string, StorageKind>>,
): string[] {
  const inMemory = Object.entries(modules)
    .filter(([, kind]) => kind === 'memory')
    .map(([name]) => name)
    .sort();
  if (inMemory.length > 0 && (appEnv === 'staging' || appEnv === 'production')) {
    throw new Error(
      `Lưu trữ bộ nhớ không được dùng ở ${appEnv} (module: ${inMemory.join(', ')}) — cần repository Prisma.`,
    );
  }
  return inMemory;
}
