// Contract test dùng chung (QA F, T-017 §B.4): chạy cho InMemory (unit) và Prisma/Valkey (integration).
import { T0, T1, newToken, newUser, type AuthPersistence } from './fixtures';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

export function describeRefreshTokenRepositoryContract(
  name: string,
  setup: () => Promise<AuthPersistence>,
): void {
  describe(`IRefreshTokenRepository contract — ${name}`, () => {
    let p: AuthPersistence;
    let userId: string;
    beforeEach(async () => {
      p = await setup();
      const u = newUser();
      await p.users.add(u);
      userId = u.id;
    });

    it('add token_hash trùng ⇒ ném (QA B.4 P2)', async () => {
      const hash = 'a'.repeat(64);
      await p.refreshTokens.add(newToken(userId, randomUUID(), hash));
      await expect(p.refreshTokens.add(newToken(userId, randomUUID(), hash))).rejects.toThrow();
    });

    it('markRotated có điều kiện: lần đầu true, lần hai false', async () => {
      const t1 = newToken(userId);
      const t2 = newToken(userId, t1.familyId);
      await p.refreshTokens.add(t1);
      await p.refreshTokens.add(t2);
      expect(await p.refreshTokens.markRotated(t1.id, t2.id, T1)).toBe(true);
      expect(await p.refreshTokens.markRotated(t1.id, t2.id, T1)).toBe(false);
      expect((await p.refreshTokens.findByHash(t1.tokenHash))?.toSnapshot()).toMatchObject({
        revokedReason: 'ROTATED',
        replacedById: t2.id,
      });
    });

    it('revokeFamily: chỉ thu hồi token CHƯA thu hồi, trả số token mới bị thu hồi; ROTATED giữ nguyên lý do', async () => {
      const family = randomUUID();
      const [t1, t2, t3] = [
        newToken(userId, family),
        newToken(userId, family),
        newToken(userId, family),
      ];
      for (const t of [t1, t2, t3]) await p.refreshTokens.add(t);
      await p.refreshTokens.markRotated(t1.id, t2.id, T0);
      expect(await p.refreshTokens.revokeFamily(family, 'REUSE_DETECTED', T1)).toBe(2);
      expect((await p.refreshTokens.findByHash(t1.tokenHash))?.revokedReason).toBe('ROTATED');
      expect(await p.refreshTokens.revokeFamily(family, 'LOGOUT', T1)).toBe(0);
    });

    it('revokeAllForUser chỉ đụng token của user đó', async () => {
      const other = newUser();
      await p.users.add(other);
      await p.refreshTokens.add(newToken(userId));
      await p.refreshTokens.add(newToken(other.id));
      expect(await p.refreshTokens.revokeAllForUser(userId, 'LOGOUT_ALL', T1)).toBe(1);
      expect(await p.refreshTokens.revokeAllForUser(other.id, 'LOGOUT_ALL', T1)).toBe(1);
    });

    it('isSessionRevoked: family có LOGOUT/REUSE_DETECTED ⇒ true; chỉ ROTATED ⇒ false; family khác ⇒ không ảnh hưởng (QA B.4 P1)', async () => {
      const [rotated, reused, loggedOut] = [randomUUID(), randomUUID(), randomUUID()];
      const r1 = newToken(userId, rotated);
      const r2 = newToken(userId, rotated);
      await p.refreshTokens.add(r1);
      await p.refreshTokens.add(r2);
      await p.refreshTokens.markRotated(r1.id, r2.id, T0);
      await p.refreshTokens.add(newToken(userId, reused));
      await p.refreshTokens.revokeFamily(reused, 'REUSE_DETECTED', T0);
      await p.refreshTokens.add(newToken(userId, loggedOut));
      await p.refreshTokens.revokeFamily(loggedOut, 'LOGOUT', T0);
      expect(await p.refreshTokens.isSessionRevoked(rotated)).toBe(false);
      expect(await p.refreshTokens.isSessionRevoked(reused)).toBe(true);
      expect(await p.refreshTokens.isSessionRevoked(loggedOut)).toBe(true);
      expect(await p.refreshTokens.isSessionRevoked(randomUUID())).toBe(false);
    });
  });
}
