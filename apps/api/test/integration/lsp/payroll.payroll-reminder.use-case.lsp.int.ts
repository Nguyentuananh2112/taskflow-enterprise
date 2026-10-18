// LSP (T-049): chạy lại ĐÚNG file test `modules/payroll/application/use-cases/payroll-reminder.use-case.test.ts` trên `PrismaPayrollStore` + PrismaUnitOfWork
// (migration 7 — trigger bất biến sau phát hành, partial unique bản hiệu lực, CHECK), Postgres thật.
import { afterAll, beforeEach, vi } from 'vitest';

import type * as HarnessModule from '../../../src/modules/payroll/testing/payroll-harness';

import { disconnectTestPrisma } from '../support/prisma-test-kit';
import { resetPayrollDatabase } from '../payroll/prisma-payroll-backend';

vi.mock('../../../src/modules/payroll/testing/payroll-harness', async (importOriginal) => {
  const actual = await importOriginal<typeof HarnessModule>();
  const { prismaPayrollBackend } = await import('../payroll/prisma-payroll-backend');
  return {
    ...actual,
    createPayrollHarness: (now?: string) =>
      actual.createPayrollHarness(now, prismaPayrollBackend()),
  };
});

beforeEach(resetPayrollDatabase);
afterAll(disconnectTestPrisma);

await import('../../../src/modules/payroll/application/use-cases/payroll-reminder.use-case.test');
