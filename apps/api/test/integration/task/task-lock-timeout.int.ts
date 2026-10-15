// Review B T-033 F3: chờ khóa cột (advisory) có `lock_timeout` — Postgres THẬT trả 55P03, được nhận là lỗi
// tạm thời (chạy lại transaction) chứ không chờ vô hạn giữ connection của pool.
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { transientDbErrorCode } from '../../../src/core/persistence/transient-db-error';
import { PrismaTaskRepository } from '../../../src/modules/task/infrastructure/persistence/prisma/prisma-task.repository';
import { disconnectTestPrisma, RecordingUnitOfWork, testPrisma } from '../support/prisma-test-kit';

afterAll(disconnectTestPrisma);

describe('lockColumn có lock_timeout (review B T-033 F3)', () => {
  it('cột đang bị transaction khác giữ khóa ⇒ lỗi 55P03 sau ~2s (không treo), là lỗi tạm thời', async () => {
    const projectId = randomUUID();
    const key = `taskflow:rank:${projectId}:TODO`;
    const prisma = testPrisma();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    // Transaction A giữ khóa cột cho tới khi test xong.
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;

    const uow = new RecordingUnitOfWork();
    const repo = new PrismaTaskRepository(() => uow.db());
    const started = Date.now();
    const error = await uow
      .run(() => repo.lockColumn(projectId, 'TODO'))
      .then(
        () => undefined,
        (err: unknown) => err,
      );
    const waited = Date.now() - started;
    release();
    await holder;

    expect(error).toBeDefined();
    expect(transientDbErrorCode(error)).toBe('55P03');
    expect(waited).toBeGreaterThanOrEqual(1_800);
    expect(waited).toBeLessThan(6_000);
  });

  it('không ai giữ khóa ⇒ khóa được ngay', async () => {
    const uow = new RecordingUnitOfWork();
    const repo = new PrismaTaskRepository(() => uow.db());
    await expect(uow.run(() => repo.lockColumn(randomUUID(), 'TODO'))).resolves.toBeUndefined();
  });
});
