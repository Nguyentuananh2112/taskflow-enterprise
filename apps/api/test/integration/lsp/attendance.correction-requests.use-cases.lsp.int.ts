// LSP (T-056): chạy lại ĐÚNG file test `modules/attendance/application/use-cases/correction-requests.use-cases.test.ts` trên
// store Prisma (migration 8 — partial unique PENDING, unique idempotency, CHECK) + PrismaUnitOfWork, Postgres thật.
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

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

await import('../../../src/modules/attendance/application/use-cases/correction-requests.use-cases.test');
