// Auth trên Postgres thật (T-020): xoay refresh đồng thời, đăng ký đồng thời với provisioner Workspace thật.
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EmailAlreadyExistsError, RefreshInProgressError } from '../../../src/core/errors';
import { RefreshSessionUseCase } from '../../../src/modules/auth/application/use-cases/refresh-session.use-case';
import { RegisterUseCase } from '../../../src/modules/auth/application/use-cases/register.use-case';
import { META, PASSWORD, createAuthHarness } from '../../../src/modules/auth/testing/auth-harness';
import { DefaultWorkspaceProvisioner } from '../../../src/modules/workspace/application/adapters/workspace-provisioner';
import { WorkspaceCreator } from '../../../src/modules/workspace/application/workspace-creator';
import {
  PrismaMembershipRepository,
  PrismaProjectRepository,
  PrismaWorkspaceRepository,
} from '../../../src/modules/workspace/infrastructure/persistence/prisma/prisma-repositories';
import { prismaAuthBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

const RUNS = 20;
const RACE_TIMEOUT = 180_000;
const realRandom = { token: (n: number) => randomBytes(n).toString('base64url'), int: randomInt };

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

describe('Register đồng thời với provisioner Workspace thật (cùng transaction)', () => {
  function registerWithRealProvisioner() {
    const { h, db } = harness();
    const workspaces = new PrismaWorkspaceRepository(db);
    const memberships = new PrismaMembershipRepository(db);
    const creator = new WorkspaceCreator({ workspaces, memberships, ids: h.ids, clock: h.clock });
    const provisioner = new DefaultWorkspaceProvisioner({
      creator,
      projects: new PrismaProjectRepository(db),
      random: realRandom,
      ids: h.ids,
      clock: h.clock,
    });
    return { h, register: new RegisterUseCase({ ...h, provisioner }) };
  }

  it('REG-03: cùng email đồng thời ⇒ 1 thành công, 1 EMAIL_ALREADY_EXISTS (từ unique constraint), không mồ côi', async () => {
    const { register } = registerWithRealProvisioner();
    const input = (fullName: string) => ({
      email: 'alice@example.com',
      password: PASSWORD,
      fullName,
      meta: META,
    });
    const results = await Promise.allSettled([
      register.execute(input('Alice One')),
      register.execute(input('Alice Two')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')?.reason).toBeInstanceOf(
      EmailAlreadyExistsError,
    );
    const p = testPrisma();
    expect(await p.user.count()).toBe(1);
    expect(await p.workspace.count()).toBe(1);
    expect(await p.workspaceMember.count()).toBe(1);
    expect(await p.project.count()).toBe(1);
  });

  it('REG-15/SEC-40: cùng họ tên, khác email, đồng thời ⇒ cả hai thành công, slug khác nhau', async () => {
    const { register } = registerWithRealProvisioner();
    const input = (email: string) => ({
      email,
      password: PASSWORD,
      fullName: 'Nguyễn Văn Đức',
      meta: META,
    });
    const [a, b] = await Promise.all([
      register.execute(input('a@example.com')),
      register.execute(input('b@example.com')),
    ]);
    const slugs = await testPrisma().workspace.findMany({
      select: { slug: true },
      orderBy: { slug: 'asc' },
    });
    expect(a.defaultWorkspaceId).not.toBe(b.defaultWorkspaceId);
    expect(slugs.map((s) => s.slug)[0]).toBe('nguyen-van-duc');
    expect(slugs[1]?.slug).toMatch(/^nguyen-van-duc-[a-z0-9]{6}$/);
  });
});
