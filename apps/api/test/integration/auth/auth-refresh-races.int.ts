// X4 (T-032, cross-read của F): refresh ‖ logout-all / change-password trên Postgres thật. Trước khi
// sửa: `revokeAllForUser` (UPDATE … WHERE revoked_at IS NULL, READ COMMITTED) không thấy token mới Y
// mà refresh vừa chèn ⇒ Y sống sót sau thu hồi. Cửa sổ được nới bằng độ trễ sau `markRotated`.
import { afterAll, describe, expect, it } from 'vitest';

import { RefreshTokenInvalidError } from '../../../src/core/errors';
import { ChangePasswordUseCase } from '../../../src/modules/auth/application/use-cases/change-password.use-case';
import { LogoutAllUseCase } from '../../../src/modules/auth/application/use-cases/logout-all.use-case';
import { RefreshSessionUseCase } from '../../../src/modules/auth/application/use-cases/refresh-session.use-case';
import { META, PASSWORD, createAuthHarness } from '../../../src/modules/auth/testing/auth-harness';
import { prismaAuthBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

const RUNS = 20;
const RACE_TIMEOUT = 300_000;
afterAll(disconnectTestPrisma);

async function fresh() {
  await resetDatabase();
  const h = createAuthHarness(prismaAuthBackend());
  const markRotated = h.refreshTokens.markRotated.bind(h.refreshTokens);
  h.refreshTokens.markRotated = async (...args) => {
    const ok = await markRotated(...args);
    await new Promise((r) => setTimeout(r, 25)); // giữ transaction refresh mở trước COMMIT
    return ok;
  };
  const alice = await h.seedUser();
  const session = await h.seedSession(alice);
  return { h, alice, session };
}

const liveTokens = (userId: string) =>
  testPrisma().refreshToken.count({ where: { userId, revokedAt: null } });

async function expectNoSurvivor(
  h: Awaited<ReturnType<typeof fresh>>['h'],
  userId: string,
  refreshed: PromiseSettledResult<{ session: { refreshToken: string } }>,
  round: number,
) {
  expect(await liveTokens(userId), `vòng ${round}: còn refresh token sống`).toBe(0);
  if (refreshed.status === 'fulfilled') {
    await expect(
      new RefreshSessionUseCase(h).execute({
        refreshToken: refreshed.value.session.refreshToken,
        meta: META,
      }),
      `vòng ${round}: token mới Y vẫn dùng được`,
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  }
}

describe('X4: refresh ‖ thu hồi mọi phiên', () => {
  it(
    `refresh ‖ logout-all ⇒ không refresh token nào sống sót (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, alice, session } = await fresh();
        const [refreshed, logoutAll] = await Promise.allSettled([
          new RefreshSessionUseCase(h).execute({ refreshToken: session.refreshToken, meta: META }),
          new LogoutAllUseCase(h).execute({ userId: alice.id }),
        ]);
        expect(logoutAll.status, `vòng ${i}`).toBe('fulfilled');
        await expectNoSurvivor(h, alice.id, refreshed, i);
      }
    },
    RACE_TIMEOUT,
  );

  it(
    `refresh ‖ change-password ⇒ chỉ còn đúng phiên mới của change-password (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, alice, session } = await fresh();
        const [refreshed, changed] = await Promise.allSettled([
          new RefreshSessionUseCase(h).execute({ refreshToken: session.refreshToken, meta: META }),
          new ChangePasswordUseCase(h).execute({
            userId: alice.id,
            currentPassword: PASSWORD,
            newPassword: `brand-new-passphrase-${i}`,
            meta: META,
          }),
        ]);
        expect(changed.status, `vòng ${i}`).toBe('fulfilled');
        expect(await liveTokens(alice.id), `vòng ${i}: chỉ phiên của change-password`).toBe(1);
        if (refreshed.status === 'fulfilled') {
          await expect(
            new RefreshSessionUseCase(h).execute({
              refreshToken: refreshed.value.session.refreshToken,
              meta: META,
            }),
          ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
        }
      }
    },
    RACE_TIMEOUT,
  );
});
