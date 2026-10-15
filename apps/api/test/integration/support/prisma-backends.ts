// Backend Prisma cho harness test (LSP, T-020): cùng hợp đồng với bản InMemory, thêm `rows()` để
// test đọc trạng thái lưu trữ. Thứ tự `rows()` = thứ tự tạo (created_at/joined_at, rồi id).
import type { AuthBackend } from '../../../src/modules/auth/testing/auth-harness';
import { PrismaRefreshTokenRepository } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-refresh-token.repository';
import { PrismaUserRepository } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-user.repository';
import type { UserSummary } from '../../../src/modules/workspace/application/ports/collaborators.port';
import {
  PrismaMembershipRepository,
  PrismaProjectRepository,
  PrismaWorkspaceRepository,
} from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-repositories';
import {
  PrismaUserDirectory,
  PrismaWorkspaceQueries,
} from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-queries';
import { PrismaWorkspacePurger } from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-workspace.purger';
import type { WorkspaceBackend } from '../../../src/modules/workspace/testing/harness';
import { RecordingUnitOfWork, testPrisma } from './prisma-test-kit';

class TestUserRepository extends PrismaUserRepository {
  rows() {
    return testPrisma().user.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }
}
class TestRefreshTokenRepository extends PrismaRefreshTokenRepository {
  rows() {
    return testPrisma().refreshToken.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }
}

export function prismaAuthBackend(): AuthBackend & { uow: RecordingUnitOfWork } {
  const uow = new RecordingUnitOfWork();
  const db = () => uow.db();
  return {
    users: new TestUserRepository(db),
    refreshTokens: new TestRefreshTokenRepository(db),
    uow,
  };
}

class TestWorkspaceRepository extends PrismaWorkspaceRepository {
  rows() {
    return testPrisma().workspace.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        deletedAt: true,
        purgeAt: true,
        deletedById: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
class TestMembershipRepository extends PrismaMembershipRepository {
  rows() {
    return testPrisma().workspaceMember.findMany({
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        role: true,
        joinedAt: true,
        updatedAt: true,
      },
    });
  }
}
class TestProjectRepository extends PrismaProjectRepository {
  rows() {
    return testPrisma().project.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }
}
/** Directory thật + `seed()` chèn dòng `users` (FK của workspace_members). */
class TestUserDirectory extends PrismaUserDirectory {
  async seed(user: UserSummary): Promise<void> {
    await testPrisma().user.create({
      data: { ...user, passwordHash: 'h:seed' },
      select: { id: true },
    });
  }
}

export function prismaWorkspaceBackend(): WorkspaceBackend & { uow: RecordingUnitOfWork } {
  const uow = new RecordingUnitOfWork();
  const db = () => uow.db();
  return {
    workspaces: new TestWorkspaceRepository(db),
    memberships: new TestMembershipRepository(db),
    projects: new TestProjectRepository(db),
    users: new TestUserDirectory(db),
    queries: new PrismaWorkspaceQueries(db),
    purger: new PrismaWorkspacePurger(db),
    uow,
  };
}
