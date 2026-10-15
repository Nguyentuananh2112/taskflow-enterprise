// Contract test dùng chung (QA F, T-017 §B.4): chạy cho InMemory (unit) và Prisma/Valkey (integration).
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ISessionRevocationStore } from '../../application/ports/session-revocation-store.port';

export function describeSessionStoreContract(
  name: string,
  setup: () => Promise<ISessionRevocationStore>,
): void {
  describe(`ISessionRevocationStore contract — ${name}`, () => {
    let store: ISessionRevocationStore;
    beforeEach(async () => {
      store = await setup();
    });
    const ids = () => [`t020-u-${randomUUID()}`, `t020-s-${randomUUID()}`] as const;

    it('read khi trống ⇒ { null, false }; revokeSession ⇒ sessionRevoked', async () => {
      const [u, s] = ids();
      expect(await store.read(u, s)).toEqual({ tokenVersion: null, sessionRevoked: false });
      await store.revokeSession(s, 900);
      expect(await store.read(u, s)).toEqual({ tokenVersion: null, sessionRevoked: true });
    });

    it('ALL-05 / ADR-105: prime (SET NX) KHÔNG đè giá trị đã ghi; set (writer) luôn đè (QA B.4 P1)', async () => {
      const [u, s] = ids();
      await store.setTokenVersion(u, 2);
      await store.primeTokenVersion(u, 1);
      expect((await store.read(u, s)).tokenVersion).toBe(2);
      const [v] = ids();
      await store.primeTokenVersion(v, 1);
      expect((await store.read(v, s)).tokenVersion).toBe(1);
      await store.setTokenVersion(v, 3);
      expect((await store.read(v, s)).tokenVersion).toBe(3);
    });
  });
}
