// LSP (T-020): chạy lại ĐÚNG file test use case `modules/auth/application/use-cases/refresh-session.use-case.test.ts`, chỉ đổi factory harness sang
// repo Prisma + PrismaUnitOfWork trên Postgres thật — không sửa dòng test nào khi đổi backend.
// Mỗi file test gốc một file runner: beforeEach cấp file của file gốc không lan sang file khác.
import { afterAll, beforeEach, vi } from 'vitest';

import type * as HarnessModule from '../../../src/modules/auth/testing/auth-harness';

import { disconnectTestPrisma, resetDatabase } from '../support/prisma-test-kit';

vi.mock('../../../src/modules/auth/testing/auth-harness', async (importOriginal) => {
  const actual = await importOriginal<typeof HarnessModule>();
  const { prismaAuthBackend } = await import('../support/prisma-backends');
  return { ...actual, createAuthHarness: () => actual.createAuthHarness(prismaAuthBackend()) };
});

// Đăng ký TRƯỚC khi nạp file test (import động) ⇒ truncate chạy trước beforeEach của file gốc.
beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

await import('../../../src/modules/auth/application/use-cases/refresh-session.use-case.test');
