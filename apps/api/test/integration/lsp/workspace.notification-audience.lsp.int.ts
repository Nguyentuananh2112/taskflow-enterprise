// LSP (T-040b L2): chạy lại ĐÚNG file test `modules/workspace/application/adapters/notification-audience.test.ts`,
// chỉ đổi factory harness sang repo Prisma + PrismaUnitOfWork trên Postgres thật.
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

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

await import('../../../src/modules/workspace/application/adapters/notification-audience.test');
