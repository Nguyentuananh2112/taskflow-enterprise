// Store Valkey thật (MGET, TTL 60s, SET NX) và ADR-105 fail-closed khi Valkey chết (T-020).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ServiceUnavailableError, UnauthorizedError } from '../../../src/core/errors';
import { AccessTokenAuthenticator } from '../../../src/modules/auth/application/access-token-authenticator';
import { LogoutAllUseCase } from '../../../src/modules/auth/application/use-cases/logout-all.use-case';
import { ValkeySessionRevocationStore } from '../../../src/modules/auth/infrastructure/cache/valkey-session-revocation.store';
import { META, createAuthHarness } from '../../../src/modules/auth/testing/auth-harness';
import { prismaAuthBackend } from '../support/prisma-backends';
import {
  connectTestValkey,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

function harness() {
  const backend = prismaAuthBackend();
  return { h: createAuthHarness(backend), db: () => backend.uow.db() };
}

beforeEach(resetDatabase);
afterAll(disconnectTestPrisma);

describe('ValkeySessionRevocationStore (Valkey 9.1.2 thật)', () => {
  it('read: MGET tv + sid; setTokenVersion TTL 60s (ADR-105); revokeSession TTL theo tham số', async () => {
    const client = await connectTestValkey();
    // Valkey 6380 dùng chung (ADR-106): KHÔNG flushDb — khóa ngẫu nhiên riêng cho lần chạy này.
    const [u1, s1] = [`t020-u-${randomUUID()}`, `t020-s-${randomUUID()}`];
    try {
      const store = new ValkeySessionRevocationStore(client);
      expect(await store.read(u1, s1)).toEqual({ tokenVersion: null, sessionRevoked: false });
      await store.setTokenVersion(u1, 3);
      await store.revokeSession(s1, 900);
      expect(await store.read(u1, s1)).toEqual({ tokenVersion: 3, sessionRevoked: true });
      const tvTtl = await client.ttl(`auth:tv:${u1}`);
      expect(tvTtl).toBeGreaterThan(50);
      expect(tvTtl).toBeLessThanOrEqual(60);
      expect(await client.ttl(`auth:sid-revoked:${s1}`)).toBeGreaterThan(890);
      await client.del([`auth:tv:${u1}`, `auth:sid-revoked:${s1}`]);
    } finally {
      await client.quit();
    }
  });

  it('ALL-05: reader SET NX không ghi đè writer (cả hai thứ tự đều kết thúc với tv mới)', async () => {
    const client = await connectTestValkey();
    const [u1, u2, sid] = [
      `t020-u-${randomUUID()}`,
      `t020-u-${randomUUID()}`,
      `t020-s-${randomUUID()}`,
    ];
    try {
      const store = new ValkeySessionRevocationStore(client);
      await store.setTokenVersion(u1, 2); // writer trước
      await store.primeTokenVersion(u1, 1); // reader đọc DB cũ, đến sau
      expect((await store.read(u1, sid)).tokenVersion).toBe(2);
      await store.primeTokenVersion(u2, 1); // reader trước
      await store.setTokenVersion(u2, 2); // writer sau ghi đè
      expect((await store.read(u2, sid)).tokenVersion).toBe(2);
      await client.del([`auth:tv:${u1}`, `auth:tv:${u2}`]);
    } finally {
      await client.quit();
    }
  });

  it('Valkey chết ⇒ lệnh ném (để use case/authenticator quyết định fallback)', async () => {
    const client = await connectTestValkey();
    const store = new ValkeySessionRevocationStore(client);
    await client.quit();
    await expect(store.read('t020-u-dead', 't020-s-dead')).rejects.toThrow();
  });
});

describe('SEC-24 / ALL-03 / ADR-105 với Postgres + Valkey thật', () => {
  it('SEC-24b: Valkey chết khi GHI ⇒ logout-all 503, DB không đổi (tv, refresh token), token cũ vẫn dùng như trước', async () => {
    const { h } = harness();
    const alice = await h.seedUser();
    const old = await h.seedSession(alice);
    const dead = await connectTestValkey();
    await dead.quit();
    const deadStore = new ValkeySessionRevocationStore(dead);
    await expect(
      new LogoutAllUseCase({ ...h, store: deadStore }).execute({ userId: alice.id }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    const p = testPrisma();
    expect((await p.user.findUniqueOrThrow({ where: { id: alice.id } })).tokenVersion).toBe(0);
    expect(
      await p.refreshToken.count({ where: { userId: alice.id, revokedAt: { not: null } } }),
    ).toBe(0);
    expect(old.refreshToken).toBeTruthy();
  });

  it('SEC-24: logout-all thành công, sau đó Valkey chết khi ĐỌC ⇒ token cũ vẫn bị từ chối nhờ fallback DB', async () => {
    const { h } = harness();
    const alice = await h.seedUser();
    const old = await h.seedSession(alice);
    const live = await connectTestValkey();
    await new LogoutAllUseCase({ ...h, store: new ValkeySessionRevocationStore(live) }).execute({
      userId: alice.id,
    });
    await live.del(`auth:tv:${alice.id}`);
    await live.quit(); // giờ Valkey "chết" với authenticator
    const auth = new AccessTokenAuthenticator({
      ...h,
      store: new ValkeySessionRevocationStore(live),
    });
    await expect(auth.authenticate(`Bearer ${old.accessToken}`)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const fresh = await h.uow.run(() => h.issuer.startNew({ id: alice.id, tokenVersion: 1 }, META));
    await expect(auth.authenticate(`Bearer ${fresh.accessToken}`)).resolves.toMatchObject({
      id: alice.id,
      tv: 1,
    });
    expect(h.logger.messages('warn')).toContain('auth.session_cache_unavailable');
  });
});
