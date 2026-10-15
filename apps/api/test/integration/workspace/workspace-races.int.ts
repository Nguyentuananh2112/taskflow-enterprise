// Race thật trên Postgres (T-020): khóa FOR UPDATE / FOR SHARE / UPDATE có điều kiện. Mỗi kịch bản
// lặp 20 lần, mỗi lần dữ liệu mới, hai thao tác chạy song song trên 2 connection (2 transaction).
import { afterAll, describe, expect, it } from 'vitest';

import { FakeClock, FakeRandom } from '../../support';
import { BusinessRuleViolationError, ResourceNotFoundError } from '../../../src/core/errors';
import { ChangeMemberRoleUseCase } from '../../../src/modules/workspace/application/use-cases/change-member-role.use-case';
import { PurgeDeletedWorkspacesJob } from '../../../src/modules/workspace/application/use-cases/purge-deleted-workspaces.job';
import { RemoveMemberUseCase } from '../../../src/modules/workspace/application/use-cases/remove-member.use-case';
import { RestoreWorkspaceUseCase } from '../../../src/modules/workspace/application/use-cases/restore-workspace.use-case';
import { PrismaAssigneeDirectory } from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-task-ports';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
} from '../../../src/modules/workspace/testing/harness';
import { prismaWorkspaceBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';
import { SqlTaskAssignmentCleaner, seedTask } from './task-fixtures';

const RUNS = 20;
const DAY = 86_400_000;
afterAll(disconnectTestPrisma);

/** Race chạy chậm trên máy dev bận (seed lại mỗi lần) — timeout riêng, rộng. */
const RACE_TIMEOUT = 180_000;

async function fresh(extra = {}) {
  await resetDatabase();
  const backend = prismaWorkspaceBackend();
  const h = createWorkspaceHarness(new FakeRandom(), backend);
  const ctx = await givenWorkspaceA(h, extra);
  return { h, ctx, db: () => backend.uow.db() };
}

const settle = (...ops: Promise<unknown>[]) => Promise.allSettled(ops);
const owners = async (workspaceId: string) =>
  testPrisma().workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
const isLastOwner = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' &&
  r.reason instanceof BusinessRuleViolationError &&
  r.reason.details?.['rule'] === 'LAST_OWNER';

describe('LAST_OWNER chống race (ADR-046) — lockOwners FOR UPDATE ORDER BY id', () => {
  it(
    `ROL-05: hai OWNER hạ nhau đồng thời ⇒ đúng 1 thành công, 1 LAST_OWNER, không deadlock (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, ctx } = await fresh({ Olga: 'OWNER' });
        const change = new ChangeMemberRoleUseCase(h);
        const results = await settle(
          change.execute(ctx.alice, { userId: uid('olga'), role: 'PM' }),
          change.execute(ctx.olga, { userId: uid('alice'), role: 'PM' }),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(isLastOwner)).toHaveLength(1);
        expect(await owners(ctx.A)).toBe(1);
      }
    },
    RACE_TIMEOUT,
  );

  // Biến thể nguy hiểm thật: nếu CẢ HAI thành công thì không còn OWNER nào (Alice rời + Olga thành PM).
  // ("Alice hạ Olga + Olga tự rời" như spec cũ không bao giờ về 0 OWNER — đã sửa spec, T-020.)
  it(
    `REM-07a: Alice hạ Olga + Alice tự rời đồng thời ⇒ đúng 1 thành công, còn 1 OWNER (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, ctx } = await fresh({ Olga: 'OWNER' });
        const results = await settle(
          new ChangeMemberRoleUseCase(h).execute(ctx.alice, { userId: uid('olga'), role: 'PM' }),
          new RemoveMemberUseCase(h).execute(ctx.alice, { userId: uid('alice') }),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(isLastOwner)).toHaveLength(1);
        expect(await owners(ctx.A)).toBe(1);
      }
    },
    RACE_TIMEOUT,
  );

  it(
    `REM-07b: hai OWNER xóa nhau đồng thời ⇒ đúng 1 thành công, không deadlock (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, ctx } = await fresh({ Olga: 'OWNER' });
        const remove = new RemoveMemberUseCase(h);
        const results = await settle(
          remove.execute(ctx.alice, { userId: uid('olga') }),
          remove.execute(ctx.olga, { userId: uid('alice') }),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(isLastOwner)).toHaveLength(1);
        expect(await owners(ctx.A)).toBe(1);
      }
    },
    RACE_TIMEOUT,
  );
});

describe('ROL-07: gán task (FOR SHARE) đồng thời với hạ VIEWER (FOR UPDATE + bỏ gán) — ADR-044', () => {
  it(
    `không lần nào kết thúc với task gán cho VIEWER (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, ctx, db } = await fresh();
        const projectId = await h.project(ctx.A, 'WEB');
        const taskId = await seedTask({ workspaceId: ctx.A, projectId, number: 1 });
        const prisma = testPrisma();
        const demote = new ChangeMemberRoleUseCase({
          ...h,
          cleaner: new SqlTaskAssignmentCleaner(db),
        });
        const assigneeDirectory = new PrismaAssigneeDirectory(db);
        // Phía "assign" của module Task (T-018) mô phỏng tối thiểu: roleOf FOR SHARE rồi UPDATE trong cùng tx.
        const assign = h.uow.run(async () => {
          const role = await assigneeDirectory.roleOf({ workspaceId: ctx.A, userId: uid('mia') });
          if (role === null || role === 'VIEWER') return 'rejected';
          await db().task.update({
            where: { id: taskId },
            data: { assigneeId: uid('mia'), version: { increment: 1 } },
          });
          return 'assigned';
        });
        await settle(assign, demote.execute(ctx.alice, { userId: uid('mia'), role: 'VIEWER' }));
        const [task, member] = await Promise.all([
          prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { assigneeId: true } }),
          prisma.workspaceMember.findFirstOrThrow({
            where: { workspaceId: ctx.A, userId: uid('mia') },
            select: { role: true },
          }),
        ]);
        expect(member.role).toBe('VIEWER');
        expect(task.assigneeId).toBeNull();
      }
    },
    RACE_TIMEOUT,
  );
});

describe('WSR-05: restore đồng thời với purge ở đúng mốc purge_at (UPDATE có điều kiện + kiểm lại sau khóa)', () => {
  it(
    `đúng một bên thắng; restore thắng ⇒ dữ liệu còn nguyên; purge thắng ⇒ restore 404 (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, ctx } = await fresh();
        await h.project(ctx.A, 'WEB');
        const ws = await h.workspaces.findById(ctx.A);
        ws?.softDelete(ctx.alice.userId, h.clock.now());
        if (ws) await h.workspaces.save(ws);
        const purgeAt = h.clock.now().getTime() + 30 * DAY;
        const restore = new RestoreWorkspaceUseCase({
          ...h,
          clock: new FakeClock(new Date(purgeAt - 1)),
        });
        const purge = new PurgeDeletedWorkspacesJob({
          ...h,
          clock: new FakeClock(new Date(purgeAt + 1)),
        });

        const results = await settle(
          restore.execute({ userId: ctx.alice.userId, workspaceId: ctx.A }),
          purge.execute(),
        );
        const [restored, purged] = results as [
          PromiseSettledResult<unknown>,
          PromiseSettledResult<unknown>,
        ];
        const row = await testPrisma().workspace.findUnique({
          where: { id: ctx.A },
          select: { deletedAt: true },
        });
        if (restored.status === 'fulfilled') {
          expect(purged).toMatchObject({ status: 'fulfilled', value: { purged: 0 } });
          expect(row?.deletedAt).toBeNull();
          expect(await testPrisma().project.count({ where: { workspaceId: ctx.A } })).toBe(1);
        } else {
          expect(restored.reason).toBeInstanceOf(ResourceNotFoundError);
          expect(purged).toMatchObject({ status: 'fulfilled', value: { purged: 1 } });
          expect(row).toBeNull();
        }
      }
    },
    RACE_TIMEOUT,
  );
});
