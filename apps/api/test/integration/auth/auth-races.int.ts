// Cổng nghiệm thu A4 của QA (ADR-104) trên Postgres thật: login chạy song song với đổi mật khẩu /
// đăng xuất mọi nơi — không lost update, token_version không bao giờ lùi. Lặp 20 lần, mỗi lần dữ liệu mới.
import { decodeJwt } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';

import { InvalidCredentialsError } from '../../../src/core/errors';
import { AccessTokenAuthenticator } from '../../../src/modules/auth/application/access-token-authenticator';
import { ChangePasswordUseCase } from '../../../src/modules/auth/application/use-cases/change-password.use-case';
import { LoginUseCase } from '../../../src/modules/auth/application/use-cases/login.use-case';
import { LogoutAllUseCase } from '../../../src/modules/auth/application/use-cases/logout-all.use-case';
import { META, PASSWORD, createAuthHarness } from '../../../src/modules/auth/testing/auth-harness';
import { prismaAuthBackend } from '../support/prisma-backends';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

const RUNS = 20;
const RACE_TIMEOUT = 300_000;
const NEW_PASSWORD = 'brand-new-passphrase-7';
afterAll(disconnectTestPrisma);

/** Harness Prisma + verify chậm ~25ms (mô phỏng cửa sổ argon2 — nơi lost update từng xảy ra). */
async function fresh() {
  await resetDatabase();
  const h = createAuthHarness(prismaAuthBackend());
  const verify = h.hasher.verify.bind(h.hasher);
  h.hasher.verify = async (hashed, password) => {
    await new Promise((r) => setTimeout(r, 25));
    return verify(hashed, password);
  };
  const alice = await h.seedUser();
  return { h, alice };
}

/** Refresh token chưa thu hồi của user NGOÀI phiên change-password vừa cấp — phải về 0. */
const liveRefreshTokensBesides = (userId: string, changeFamilyId: string) =>
  testPrisma().refreshToken.count({
    where: { userId, revokedAt: null, familyId: { not: changeFamilyId } },
  });

/** Access token bị từ chối và refresh token của family đã bị thu hồi. */
async function expectSessionDead(
  h: Awaited<ReturnType<typeof fresh>>['h'],
  session: { accessToken: string; familyId: string },
) {
  const accepted = await new AccessTokenAuthenticator(h)
    .authenticate(`Bearer ${session.accessToken}`)
    .then(
      () => true,
      () => false,
    );
  expect(accepted, `access token tv=${String(decodeJwt(session.accessToken).tv)} vẫn hợp lệ`).toBe(
    false,
  );
  expect(
    await testPrisma().refreshToken.count({
      where: { familyId: session.familyId, revokedAt: null },
    }),
  ).toBe(0);
}

const userRow = (id: string) =>
  testPrisma().user.findUniqueOrThrow({
    where: { id },
    select: { passwordHash: true, tokenVersion: true },
  });

describe('SEC-23b: login ‖ change-password (A4)', () => {
  it(
    `mật khẩu mới luôn được giữ, tv = 1, login không bao giờ hồi sinh hash cũ (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, alice } = await fresh();
        h.hasher.rehashNeeded = true; // nhánh nguy hiểm nhất: login cũng GHI password_hash
        const [login, change] = await Promise.allSettled([
          new LoginUseCase(h).execute({
            email: 'alice@example.com',
            password: PASSWORD,
            meta: META,
          }),
          new ChangePasswordUseCase(h).execute({
            userId: alice.id,
            currentPassword: PASSWORD,
            newPassword: NEW_PASSWORD,
            meta: META,
          }),
        ]);
        expect(change?.status).toBe('fulfilled');
        expect(await userRow(alice.id)).toEqual({
          passwordHash: `h:${NEW_PASSWORD}`,
          tokenVersion: 1,
        });
        // (Kiểm TRƯỚC các lần login kiểm tra bên dưới — chúng tự tạo phiên mới.)
        // G1 auth M1: login bằng mật khẩu CŨ không bao giờ được giữ phiên sống sót qua lần đổi. Nếu login
        // thành công thì nó phải commit TRƯỚC change-password ⇒ ký tv 0, và bị change-password thu hồi.
        if (login?.status === 'fulfilled') {
          await expectSessionDead(h, login.value.session);
        } else {
          expect(login?.reason).toBeInstanceOf(InvalidCredentialsError);
        }
        if (change?.status === 'fulfilled') {
          expect(await liveRefreshTokensBesides(alice.id, change.value.session.familyId)).toBe(0);
        }
        // Mật khẩu mới dùng được, mật khẩu cũ thì không.
        await expect(
          new LoginUseCase(h).execute({
            email: 'alice@example.com',
            password: NEW_PASSWORD,
            meta: META,
          }),
        ).resolves.toBeDefined();
        await expect(
          new LoginUseCase(h).execute({
            email: 'alice@example.com',
            password: PASSWORD,
            meta: META,
          }),
        ).rejects.toThrow();
      }
    },
    RACE_TIMEOUT,
  );
});

describe('SEC-23e: đổi mật khẩu commit TRONG cửa sổ verify của login (G1 auth M1, tất định)', () => {
  for (const rehash of [false, true]) {
    it(`login bằng mật khẩu cũ ⇒ 401, không có refresh token sống (rehash=${rehash})`, async () => {
      const { h, alice } = await fresh();
      h.hasher.rehashNeeded = rehash;
      // Login dừng ngay SAU khi verify (mật khẩu cũ còn đúng) cho tới khi change-password commit xong.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let reached!: () => void;
      const verified = new Promise<void>((r) => (reached = r));
      const verify = h.hasher.verify.bind(h.hasher);
      let first = true;
      h.hasher.verify = async (hashed, password) => {
        const ok = await verify(hashed, password);
        if (first) {
          first = false;
          reached();
          await gate;
        }
        return ok;
      };
      const login = new LoginUseCase(h)
        .execute({ email: 'alice@example.com', password: PASSWORD, meta: META })
        .then(
          (v) => ({ ok: true as const, v }),
          (e: unknown) => ({ ok: false as const, e }),
        );
      await verified;
      const change = await new ChangePasswordUseCase(h).execute({
        userId: alice.id,
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        meta: META,
      });
      release();
      const result = await login;
      if (result.ok) await expectSessionDead(h, result.v.session); // thông báo lỗi rõ hơn khi hồi quy
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.e).toBeInstanceOf(InvalidCredentialsError);
      expect(await liveRefreshTokensBesides(alice.id, change.session.familyId)).toBe(0);
      expect(await userRow(alice.id)).toEqual({
        passwordHash: `h:${NEW_PASSWORD}`,
        tokenVersion: 1,
      });
    });
  }
});

describe('SEC-21c: login ‖ logout-all (A4)', () => {
  it(
    `tv kết thúc = 1 (không lùi); token của login chỉ hợp lệ nếu được ký SAU khi tăng tv (×${RUNS})`,
    async () => {
      for (let i = 0; i < RUNS; i += 1) {
        const { h, alice } = await fresh();
        const before = await h.seedSession(alice); // phiên có từ trước phải bị thu hồi
        const [login, logoutAll] = await Promise.allSettled([
          new LoginUseCase(h).execute({
            email: 'alice@example.com',
            password: PASSWORD,
            meta: META,
          }),
          new LogoutAllUseCase(h).execute({ userId: alice.id }),
        ]);
        expect(logoutAll?.status).toBe('fulfilled');
        expect((await userRow(alice.id)).tokenVersion).toBe(1);
        const auth = new AccessTokenAuthenticator(h);
        await expect(auth.authenticate(`Bearer ${before.accessToken}`)).rejects.toThrow();
        const old = await testPrisma().refreshToken.findFirstOrThrow({
          where: { familyId: before.familyId },
        });
        expect(old.revokedReason).toBe('LOGOUT_ALL');
        if (login?.status === 'fulfilled') {
          const tv = decodeJwt(login.value.session.accessToken).tv;
          const ok = await auth.authenticate(`Bearer ${login.value.session.accessToken}`).then(
            () => true,
            () => false,
          );
          expect(ok).toBe(tv === 1);
        }
      }
    },
    RACE_TIMEOUT,
  );
});
