// LSP (T-038): chạy lại ĐÚNG file test `modules/attendance/application/use-cases/attendance-events.use-cases.test.ts`, chỉ đổi
// backend harness sang store Prisma + PrismaUnitOfWork trên Postgres thật — không sửa dòng test nào.
import { afterAll, beforeEach, vi } from 'vitest';

import type * as HarnessModule from '../../../src/modules/attendance/testing/attendance-harness';

import { disconnectTestPrisma, resetDatabase } from '../support/prisma-test-kit';

vi.mock('../../../src/modules/attendance/testing/attendance-harness', async (importOriginal) => {
  const actual = await importOriginal<typeof HarnessModule>();
  const { prismaAttendanceBackend } = await import('../attendance/prisma-attendance-backend');
  return {
    ...actual,
    createAttendanceHarness: (now?: string) =>
      actual.createAttendanceHarness(now, prismaAttendanceBackend()),
  };
});

// Đăng ký TRƯỚC khi nạp file test (import động) ⇒ truncate chạy trước beforeEach của file gốc.
beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

await import('../../../src/modules/attendance/application/use-cases/attendance-events.use-cases.test');
