// LSP (T-023): chạy lại ĐÚNG file test `modules/task/application/use-cases/create-task.use-case.test.ts`, chỉ đổi backend harness sang
// repo Prisma + PrismaUnitOfWork trên Postgres thật — không sửa dòng test nào khi đổi backend.
// Mỗi file test gốc một file runner: beforeEach cấp file của file gốc không lan sang file khác.
import { afterAll, beforeEach, vi } from 'vitest';

import type * as HarnessModule from '../../../src/modules/task/testing/task-harness';

import { disconnectTestPrisma, resetDatabase } from '../support/prisma-test-kit';

vi.mock('../../../src/modules/task/testing/task-harness', async (importOriginal) => {
  const actual = await importOriginal<typeof HarnessModule>();
  const { prismaTaskBackend } = await import('../task/prisma-task-backend');
  return { ...actual, createTaskHarness: () => actual.createTaskHarness(prismaTaskBackend()) };
});

// Đăng ký TRƯỚC khi nạp file test (import động) ⇒ truncate chạy trước beforeEach của file gốc.
beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

await import('../../../src/modules/task/application/use-cases/create-task.use-case.test');
