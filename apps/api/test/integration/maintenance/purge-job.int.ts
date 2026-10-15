// T-033 tầng I: purge theo lịch trên Postgres thật — 2 instance cùng chạy chỉ 1 lô thực thi tại một
// thời điểm (khóa advisory theo lô, ADR-095); workspace vừa được khôi phục không bị xóa.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { purgeWorkspacesJob } from '../../../src/composition/maintenance-jobs';
import type { IWorkspacePurger } from '../../../src/modules/workspace/application/ports/collaborators.port';
import { ExclusivePurgeRun } from '../../../src/modules/workspace/infrastructure/jobs/exclusive-purge-run';
import { PrismaWorkspaceRepository } from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-repositories';
import { PrismaWorkspacePurger } from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-workspace.purger';
import { FakeClock, SpyLogger } from '../../support';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const NOW = new Date('2026-12-01T00:00:00.000Z');
const PAST = new Date('2026-11-01T00:00:00.000Z');

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

/** Workspace đã xóa mềm, hết ân hạn (purge_at < NOW), có 1 project + 3 task + audit. */
async function seedDeletedWorkspace(): Promise<string> {
  const p = testPrisma();
  const user = await p.user.upsert({
    where: { email: 'owner@example.test' },
    update: {},
    create: { email: 'owner@example.test', fullName: 'Owner', passwordHash: 'x' },
  });
  const ws = await p.workspace.create({
    data: { name: 'Xóa', slug: `ws-${randomUUID().slice(0, 8)}`, deletedAt: PAST, purgeAt: PAST },
  });
  await p.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' } });
  const project = await p.project.create({
    data: { workspaceId: ws.id, name: 'P', keyPrefix: 'TF' },
  });
  for (const [i, rank] of ['a0', 'a1', 'a2'].entries()) {
    const t = await p.task.create({
      data: { workspaceId: ws.id, projectId: project.id, number: i + 1, title: `T${i}`, rank },
    });
    await p.taskAuditLog.create({
      data: {
        workspaceId: ws.id,
        projectId: project.id,
        taskId: t.id,
        actorId: user.id,
        action: 'CREATED',
      },
    });
  }
  return ws.id;
}

/** Một "instance" API: UoW + repo + purger riêng; `around` bọc purger thật để đo/ chen hành động. */
function instance(around: (inner: IWorkspacePurger) => IWorkspacePurger) {
  const uow = new RecordingUnitOfWork();
  const db = () => uow.db();
  const logger = new SpyLogger();
  const purger = new ExclusivePurgeRun(db, around(new PrismaWorkspacePurger(db)));
  const job = purgeWorkspacesJob({
    workspaces: new PrismaWorkspaceRepository(db),
    purger,
    uow,
    clock: new FakeClock(NOW),
    logger,
    intervalMs: 3_600_000,
    jitterMs: 0,
  });
  return { job, logger };
}

describe('purge theo lịch (T-033, ADR-095)', () => {
  it('2 instance cùng chạy ⇒ không bao giờ 2 lô song song; instance thua dừng lượt; mọi ws hết hạn bị xóa đúng 1 lần', async () => {
    const ids = [
      await seedDeletedWorkspace(),
      await seedDeletedWorkspace(),
      await seedDeletedWorkspace(),
    ];
    let active = 0;
    let maxActive = 0;
    const purgedBy: string[] = [];
    const measured =
      (name: string) =>
      (inner: IWorkspacePurger): IWorkspacePurger => ({
        async purge(id, now) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            const done = await inner.purge(id, now);
            if (done) purgedBy.push(`${name}:${id}`);
            // Giữ transaction (và khóa lô) thêm một lúc để instance kia chắc chắn va vào khóa.
            await new Promise((r) => setTimeout(r, 300));
            return done;
          } finally {
            active -= 1;
          }
        },
      });
    const a = instance(measured('A'));
    const b = instance(measured('B'));
    await Promise.all([a.job.run(), b.job.run()]);

    expect(maxActive).toBe(1);
    const busy = [...a.logger.messages('info'), ...b.logger.messages('info')].filter(
      (m) => m === 'maintenance.purge_skipped_busy',
    );
    expect(busy.length).toBeGreaterThanOrEqual(1);
    // Lượt sau (không còn tranh chấp) dọn nốt phần instance thua đã bỏ dở.
    await a.job.run();
    expect(await testPrisma().workspace.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await testPrisma().task.count()).toBe(0);
    expect(await testPrisma().taskAuditLog.count()).toBe(0);
    expect(new Set(purgedBy.map((x) => x.split(':')[1])).size).toBe(3);
    expect(purgedBy).toHaveLength(3);
  });

  it('restore ‖ purge: ws được khôi phục sau khi job đã liệt kê nó ⇒ purger kiểm lại và KHÔNG xóa', async () => {
    const wsId = await seedDeletedWorkspace();
    const restoreFirst = (inner: IWorkspacePurger): IWorkspacePurger => ({
      async purge(id, now) {
        // RestoreWorkspace commit đúng khe giữa listPurgeable và purge (transaction riêng).
        await testPrisma().workspace.updateMany({
          where: { id, deletedAt: { not: null } },
          data: { deletedAt: null, purgeAt: null, deletedById: null },
        });
        return inner.purge(id, now);
      },
    });
    const { job, logger } = instance(restoreFirst);
    await job.run();
    const summary = logger.entries.find((e) => e.msg === 'maintenance.purge_summary');
    expect(summary?.data).toMatchObject({ purged: 0, skipped: 1 });
    const ws = await testPrisma().workspace.findUniqueOrThrow({ where: { id: wsId } });
    expect(ws.deletedAt).toBeNull();
    expect(await testPrisma().task.count({ where: { workspaceId: wsId } })).toBe(3);
  });

  it('ws chưa hết ân hạn hoặc chưa xóa ⇒ không bị đụng', async () => {
    const live = await testPrisma().workspace.create({ data: { name: 'Sống', slug: 'ws-live' } });
    const grace = await testPrisma().workspace.create({
      data: {
        name: 'Ân hạn',
        slug: 'ws-grace',
        deletedAt: PAST,
        purgeAt: new Date('2026-12-20T00:00:00.000Z'),
      },
    });
    const { job } = instance((inner) => inner);
    await job.run();
    expect(await testPrisma().workspace.count({ where: { id: { in: [live.id, grace.id] } } })).toBe(
      2,
    );
  });
});
