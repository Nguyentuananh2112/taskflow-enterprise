import type { ILogger } from '../core/logging/logger';
import type { IUnitOfWork } from '../core/persistence/unit-of-work';
import { createInMemoryAuthRepositories, type AuthRepositories } from '../modules/auth/auth.module';
import {
  createInMemoryWorkspaceRepositories,
  type WorkspaceRepositories,
} from '../modules/workspace/workspace.module';
import { InMemoryUnitOfWork } from './in-memory-unit-of-work';
import { MirroringUserRepository } from './users';

export interface Persistence {
  kind: 'memory' | 'prisma';
  auth: AuthRepositories;
  workspace: WorkspaceRepositories;
  uow: IUnitOfWork;
}

/**
 * Lưu trữ trong bộ nhớ — dev/test, MẤT DỮ LIỆU khi khởi động lại. Composition root từ chối dùng ở
 * production. TODO(T-020 merge): `createPrismaPersistence(prisma, valkey)` cùng hình dạng
 * (repository Prisma của B + `PrismaUnitOfWork` + session store Valkey).
 */
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
    auth: { users, refreshTokens: auth.refreshTokens, sessions: auth.sessions },
    workspace: ws,
    uow,
  };
}
