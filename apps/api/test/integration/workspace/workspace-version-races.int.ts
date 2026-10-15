// ADR-110 (T-032, X2/X8 của F): race THẬT trên Postgres — hai use case song song trên 2 transaction.
// Bất kể thứ tự commit: workspace đã xóa KHÔNG BAO GIỜ sống lại; project đã archive KHÔNG BAO GIỜ
// bị gỡ archive bởi một lần đổi tên chạy song song. Kẻ thua nhận 404 / 409, không có lỗi nào khác.
import { afterAll, describe, expect, it } from 'vitest';

import { FakeRandom } from '../../support';
import { ResourceNotFoundError, VersionConflictError } from '../../../src/core/errors';
import { DeleteWorkspaceUseCase } from '../../../src/modules/workspace/application/use-cases/delete-workspace.use-case';
import { SetProjectArchivedUseCase } from '../../../src/modules/workspace/application/use-cases/set-project-archived.use-case';
import { UpdateProjectUseCase } from '../../../src/modules/workspace/application/use-cases/update-project.use-case';
import { UpdateWorkspaceUseCase } from '../../../src/modules/workspace/application/use-cases/update-workspace.use-case';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
} from '../../../src/modules/workspace/testing/harness';
import { prismaWorkspaceBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

const RUNS = 20;
const RACE_TIMEOUT = 180_000;
afterAll(disconnectTestPrisma);

async function fresh() {
  await resetDatabase();
  const h = createWorkspaceHarness(new FakeRandom(), prismaWorkspaceBackend());
  return { h, ctx: await givenWorkspaceA(h) };
}

/** Kẻ thua chỉ được nhận 404 hoặc 409 — mọi lỗi khác (deadlock, 500) là hỏng. */
const lostCleanly = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ||
  r.reason instanceof ResourceNotFoundError ||
  r.reason instanceof VersionConflictError;

describe('X2: PATCH ‖ DELETE workspace', () => {
  it(
    `DELETE thành công ⇒ workspace luôn còn xóa mềm, không hồi sinh (×${RUNS})`,
    async () => {
      let deletedWins = 0;
      for (let i = 0; i < RUNS; i += 1) {
        const { h, ctx } = await fresh();
        const [patch, del] = await Promise.allSettled([
          new UpdateWorkspaceUseCase(h).execute(ctx.alice, { name: `Renamed ${i}` }),
          new DeleteWorkspaceUseCase(h).execute(ctx.alice, { confirmSlug: 'acme' }),
        ]);
        expect(lostCleanly(patch), `vòng ${i}: patch`).toBe(true);
        expect(lostCleanly(del), `vòng ${i}: delete`).toBe(true);
        const row = await testPrisma().workspace.findUniqueOrThrow({ where: { id: ctx.A } });
        if (del.status === 'fulfilled') {
          deletedWins += 1;
          expect(row.deletedAt, `vòng ${i}: hồi sinh`).not.toBeNull();
          expect(row.purgeAt).not.toBeNull();
        } else {
          expect(row.deletedAt).toBeNull(); // DELETE thua (409) ⇒ chưa xóa, đổi tên giữ nguyên
          expect(row.name).toBe(`Renamed ${i}`);
        }
      }
      expect(deletedWins).toBeGreaterThan(0);
    },
    RACE_TIMEOUT,
  );
});

describe('X8: đổi tên ‖ archive project', () => {
  it(
    `archive thành công ⇒ project luôn còn archived (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, ctx } = await fresh();
        const projectId = await h.project(ctx.A, 'WEB');
        const [rename, archive] = await Promise.allSettled([
          new UpdateProjectUseCase(h).execute(ctx.alice, { projectId, name: `Renamed ${i}` }),
          new SetProjectArchivedUseCase(h).execute(ctx.alice, { projectId, archived: true }),
        ]);
        expect(lostCleanly(rename), `vòng ${i}: rename`).toBe(true);
        expect(lostCleanly(archive), `vòng ${i}: archive`).toBe(true);
        const row = await testPrisma().project.findUniqueOrThrow({ where: { id: projectId } });
        if (archive.status === 'fulfilled') {
          expect(row.archivedAt, `vòng ${i}: mất archive`).not.toBeNull();
        }
        if (rename.status === 'fulfilled' && archive.status === 'fulfilled') {
          expect(row.version).toBe(3); // cả hai đều ghi ⇒ tuần tự hóa, không ai ghi đè ai
        }
      }
    },
    RACE_TIMEOUT,
  );
});
