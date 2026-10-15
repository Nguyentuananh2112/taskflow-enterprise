// LSP (T-020): chạy lại ĐÚNG file test use case `modules/workspace/application/use-cases/members-add-list.test.ts`, chỉ đổi factory harness sang
// repo Prisma + PrismaUnitOfWork trên Postgres thật — không sửa dòng test nào khi đổi backend.
// Mỗi file test gốc một file runner: beforeEach cấp file của file gốc không lan sang file khác.
import { afterAll, beforeEach, vi } from 'vitest';

import type * as HarnessModule from '../../../src/modules/workspace/testing/harness';

import { disconnectTestPrisma, resetDatabase } from '../support/prisma-test-kit';

vi.mock('../../../src/modules/workspace/testing/harness', async (importOriginal) => {
  const actual = await importOriginal<typeof HarnessModule>();
  const { prismaWorkspaceBackend } = await import('../support/prisma-backends');
  return {
    ...actual,
    createWorkspaceHarness: (random?: Parameters<typeof actual.createWorkspaceHarness>[0]) =>
      actual.createWorkspaceHarness(random, prismaWorkspaceBackend()),
  };
});

// Đăng ký TRƯỚC khi nạp file test (import động) ⇒ truncate chạy trước beforeEach của file gốc.
beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

await import('../../../src/modules/workspace/application/use-cases/members-add-list.test');
