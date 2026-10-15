// G2 S2 tầng I: dọn refresh token trên Postgres thật — chỉ xóa dòng của PHIÊN đã hết hạn tuyệt đối
// quá 7 ngày (giữ token đã xoay của phiên còn sống để còn phát hiện reuse), theo lô có giới hạn,
// một instance một lúc (khóa advisory của lô).
import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { purgeRefreshTokensJob } from '../../../src/composition/maintenance-jobs';
import { PurgeExpiredRefreshTokensJob } from '../../../src/modules/auth/application/use-cases/purge-expired-refresh-tokens.job';
import {
  PrismaRefreshTokenPurger,
  REFRESH_TOKEN_PURGE_LOCK_KEY,
} from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-refresh-token.purger';
import { FakeClock, SpyLogger } from '../../support';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const NOW = new Date('2026-12-01T00:00:00.000Z');
const DAY = 24 * 3_600_000;
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * DAY);

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

async function seedUser(): Promise<string> {
  const user = await testPrisma().user.create({
    data: { email: `u-${randomUUID().slice(0, 8)}@example.test`, fullName: 'U', passwordHash: 'x' },
  });
  return user.id;
}

/** Một token; `replacedById` để dựng chuỗi xoay (FK tự tham chiếu ON DELETE SET NULL). */
async function seedToken(
  userId: string,
  t: { familyId: string; expiresAt: Date; familyExpiresAt: Date; replacedById?: string },
): Promise<string> {
  const row = await testPrisma().refreshToken.create({
    data: {
      userId,
      tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      familyId: t.familyId,
      expiresAt: t.expiresAt,
      familyExpiresAt: t.familyExpiresAt,
      replacedById: t.replacedById ?? null,
      ...(t.replacedById ? { revokedAt: daysFromNow(-20), revokedReason: 'ROTATED' as const } : {}),
      ip: '203.0.113.7',
      userAgent: 'test',
    },
  });
  return row.id;
}

function instance() {
  const uow = new RecordingUnitOfWork();
  const purger = new PrismaRefreshTokenPurger(() => uow.db());
  return {
    uow,
    purger,
    job: new PurgeExpiredRefreshTokensJob({ purger, uow, clock: new FakeClock(NOW) }),
  };
}

describe('dọn refresh token (G2 S2, security.md §2.2)', () => {
  it('chỉ xóa token của phiên hết hạn TUYỆT ĐỐI quá 7 ngày (kể cả chuỗi xoay); giữ token đã xoay của phiên còn sống', async () => {
    const userId = await seedUser();
    // Phiên A: hết hạn tuyệt đối 8 ngày trước — chuỗi xoay 2 token ⇒ xóa cả hai.
    const famA = randomUUID();
    const a2 = await seedToken(userId, {
      familyId: famA,
      expiresAt: daysFromNow(-8),
      familyExpiresAt: daysFromNow(-8),
    });
    await seedToken(userId, {
      familyId: famA,
      expiresAt: daysFromNow(-12),
      familyExpiresAt: daysFromNow(-8),
      replacedById: a2,
    });
    // Phiên B còn sống (hạn tuyệt đối +10 ngày): token đã xoay hết hạn 8 ngày trước ⇒ GIỮ (reuse).
    const famB = randomUUID();
    const b2 = await seedToken(userId, {
      familyId: famB,
      expiresAt: daysFromNow(5),
      familyExpiresAt: daysFromNow(10),
    });
    const b1 = await seedToken(userId, {
      familyId: famB,
      expiresAt: daysFromNow(-8),
      familyExpiresAt: daysFromNow(10),
      replacedById: b2,
    });
    // Phiên C: hết hạn tuyệt đối mới 6 ngày ⇒ còn trong thời gian giữ.
    const c1 = await seedToken(userId, {
      familyId: randomUUID(),
      expiresAt: daysFromNow(-6),
      familyExpiresAt: daysFromNow(-6),
    });

    const { job } = instance();
    expect(await job.execute()).toEqual({ deleted: 2, batches: 1, busy: false, complete: true });
    const left = await testPrisma().refreshToken.findMany({ select: { id: true } });
    expect(left.map((r) => r.id).sort()).toEqual([b1, b2, c1].sort());
  });

  it('theo lô có giới hạn, cũ nhất trước; chạm trần lô ⇒ lượt sau làm tiếp', async () => {
    const userId = await seedUser();
    for (let i = 0; i < 5; i++) {
      await seedToken(userId, {
        familyId: randomUUID(),
        expiresAt: daysFromNow(-10 - i),
        familyExpiresAt: daysFromNow(-10 - i),
      });
    }
    const { job } = instance();
    expect(await job.execute({ batchSize: 2, maxBatches: 2 })).toEqual({
      deleted: 4,
      batches: 2,
      busy: false,
      complete: false,
    });
    const [left] = await testPrisma().refreshToken.findMany({ select: { expiresAt: true } });
    expect(left?.expiresAt).toEqual(daysFromNow(-10)); // mới nhất còn lại
    expect(await job.execute({ batchSize: 2 })).toMatchObject({ deleted: 1, complete: true });
  });

  it('instance khác đang giữ khóa lô ⇒ busy, không xóa gì; scheduler log tổng kết busy', async () => {
    const userId = await seedUser();
    await seedToken(userId, {
      familyId: randomUUID(),
      expiresAt: daysFromNow(-30),
      familyExpiresAt: daysFromNow(-30),
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = testPrisma().$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${REFRESH_TOKEN_PURGE_LOCK_KEY}, 0))`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;

    const { uow, purger } = instance();
    const logger = new SpyLogger();
    const scheduled = purgeRefreshTokensJob({ purger, uow, clock: new FakeClock(NOW), logger });
    await scheduled.run();
    release();
    await holder;

    expect(
      logger.entries.find((e) => e.msg === 'maintenance.refresh_token_purge_summary')?.data,
    ).toMatchObject({ deleted: 0, busy: true });
    expect(await testPrisma().refreshToken.count()).toBe(1);
  });
});
