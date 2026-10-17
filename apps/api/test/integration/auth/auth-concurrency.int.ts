// Auth trên Postgres thật (T-020): xoay refresh đồng thời; kích hoạt tài khoản đồng thời (Mốc 3.5 — thay register).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivationGoneError, RefreshInProgressError } from '../../../src/core/errors';
import { RefreshSessionUseCase } from '../../../src/modules/auth/application/use-cases/refresh-session.use-case';
import {
  ActivateAccountUseCase,
  ActivationIssuer,
} from '../../../src/modules/auth/application/use-cases/activation.use-cases';
import { Email } from '../../../src/modules/auth/domain/email';
import { User } from '../../../src/modules/auth/domain/user';
import { PrismaActivationTokenRepository } from '../../../src/modules/auth/infrastructure/persistence/prisma/prisma-activation-token.repository';
import { META, PASSWORD, createAuthHarness } from '../../../src/modules/auth/testing/auth-harness';
import { prismaAuthBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

const RUNS = 20;
const RACE_TIMEOUT = 180_000;

function harness() {
  const backend = prismaAuthBackend();
  return { h: createAuthHarness(backend), db: () => backend.uow.db() };
}

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

describe('REF-06: hai request refresh đồng thời cùng một token', () => {
  it(
    `đúng 1 thành công + 1 REFRESH_IN_PROGRESS; family không bị thu hồi; còn đúng 1 token sống (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        await resetDatabase();
        const { h } = harness();
        const s1 = await h.seedSession(await h.seedUser());
        const refresh = new RefreshSessionUseCase(h);
        const results = await Promise.allSettled([
          refresh.execute({ refreshToken: s1.refreshToken, meta: META }),
          refresh.execute({ refreshToken: s1.refreshToken, meta: META }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected');
        expect(rejected?.reason).toBeInstanceOf(RefreshInProgressError);
        const rows = await h.refreshTokens.rows();
        expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
        expect(rows.some((r) => r.revokedReason === 'REUSE_DETECTED')).toBe(false);
      }
    },
    RACE_TIMEOUT,
  );
});

describe('Kích hoạt đồng thời cùng một token (ADR-137 điều 4 — `consume` đếm 1 dòng)', () => {
  it('đúng 1 thành công + 1 ACTIVATION_GONE; mật khẩu đặt đúng một lần; token đã dùng', async () => {
    const { h, db } = harness();
    const tokens = new PrismaActivationTokenRepository(db);
    const pending = User.register({
      id: h.ids.next(),
      email: Email.create('pending@example.com'),
      passwordHash: null,
      fullName: 'Pending Person',
      now: h.clock.now(),
    });
    await h.uow.run(() => h.users.add(pending));
    const issuer = new ActivationIssuer({
      tokens,
      factory: h.refreshTokenFactory,
      ids: h.ids,
      clock: h.clock,
      webOrigin: 'http://localhost:3001',
    });
    const { token } = await h.uow.run(() =>
      issuer.issue({ userId: pending.id, createdById: null, ttlMs: 60_000 }),
    );
    const activate = new ActivateAccountUseCase({ ...h, tokens, factory: h.refreshTokenFactory });
    const results = await Promise.allSettled([
      activate.execute({ token, password: PASSWORD, meta: META }),
      activate.execute({ token, password: `${PASSWORD}-other`, meta: META }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')?.reason).toBeInstanceOf(
      ActivationGoneError,
    );
    const p = testPrisma();
    expect(await p.accountActivationToken.count({ where: { usedAt: { not: null } } })).toBe(1);
    expect(await p.refreshToken.count()).toBe(1);
    expect((await p.user.findUnique({ where: { id: pending.id } }))?.passwordHash).not.toBeNull();
  });
});
