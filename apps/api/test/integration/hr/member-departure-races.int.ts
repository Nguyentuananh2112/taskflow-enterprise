// CC-HR-15 (test-spec-hr §8, T-042) — vế ĐỒNG THỜI của "xóa thành viên ⇒ departure" trên Postgres thật.
// Vế tuần tự (rollback ⇒ 0 dòng, LAST_OWNER ⇒ 0 dòng) đã có ở member-tenure.test.ts (+ runner LSP) của B.
// Mỗi kịch bản lặp 20 lần, dữ liệu mới, hai lệnh chạy song song trên 2 transaction.
import { afterAll, describe, expect, it } from 'vitest';

import { FakeRandom } from '../../support';
import { ResourceNotFoundError } from '../../../src/core/errors';
import { RemoveMemberUseCase } from '../../../src/modules/workspace/application/use-cases/remove-member.use-case';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
} from '../../../src/modules/workspace/testing/harness';
import { prismaWorkspaceBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

const RUNS = 20;
const RACE_TIMEOUT = 180_000;
afterAll(disconnectTestPrisma);

async function fresh(extra = {}) {
  await resetDatabase();
  const h = createWorkspaceHarness(new FakeRandom(), prismaWorkspaceBackend());
  const ctx = await givenWorkspaceA(h, extra);
  return { h, ctx };
}

const departuresOf = (workspaceId: string, userId: string) =>
  testPrisma().workspaceMemberDeparture.findMany({ where: { workspaceId, userId } });
const memberCount = (workspaceId: string, userId: string) =>
  testPrisma().workspaceMember.count({ where: { workspaceId, userId } });
const isNotFound = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' && r.reason instanceof ResourceNotFoundError;

describe('CC-HR-15: xóa thành viên song song ⇒ đúng 1 departure', () => {
  it(
    `hai OWNER cùng xóa Mia ⇒ 1 thành công + 1 × 404, đúng 1 dòng departure REMOVED (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, ctx } = await fresh({ Olga: 'OWNER' });
        const remove = new RemoveMemberUseCase(h);
        const results = await Promise.allSettled([
          remove.execute(ctx.alice, { userId: uid('mia') }),
          remove.execute(ctx.olga, { userId: uid('mia') }),
        ]);
        expect(
          results.filter((r) => r.status === 'fulfilled'),
          `#${String(i)}`,
        ).toHaveLength(1);
        expect(results.filter(isNotFound), `#${String(i)}`).toHaveLength(1);
        const rows = await departuresOf(ctx.A, uid('mia'));
        expect(rows, `#${String(i)}: số departure`).toHaveLength(1);
        expect(rows[0]?.reason).toBe('REMOVED');
        expect(await memberCount(ctx.A, uid('mia'))).toBe(0);
      }
    },
    RACE_TIMEOUT,
  );

  it(
    `Mia tự rời ‖ OWNER xóa Mia ⇒ 1 thành công, đúng 1 departure, reason khớp bên thắng (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, ctx } = await fresh();
        const remove = new RemoveMemberUseCase(h);
        const [self, byOwner] = await Promise.allSettled([
          remove.execute(ctx.mia, { userId: uid('mia') }),
          remove.execute(ctx.alice, { userId: uid('mia') }),
        ]);
        const wins = [self, byOwner].filter((r) => r.status === 'fulfilled');
        expect(wins, `#${String(i)}`).toHaveLength(1);
        const rows = await departuresOf(ctx.A, uid('mia'));
        expect(rows, `#${String(i)}: số departure`).toHaveLength(1);
        expect(rows[0]?.reason, `#${String(i)}`).toBe(
          self.status === 'fulfilled' ? 'LEFT' : 'REMOVED',
        );
      }
    },
    RACE_TIMEOUT,
  );
});
