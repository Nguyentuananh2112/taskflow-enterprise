import { beforeEach, describe, expect, it } from 'vitest';

import { ServiceUnavailableError } from '../../../../core/errors';

import { createAuthHarness, type AuthHarness } from '../../testing/auth-harness';
import { LogoutUseCase } from './logout.use-case';

let h: AuthHarness;
let logout: LogoutUseCase;

beforeEach(() => {
  h = createAuthHarness();
  logout = new LogoutUseCase(h);
});

describe('LogoutUseCase (security.md 1.5)', () => {
  it('OUT-01: thu hồi cả family (LOGOUT), sid-revoked TTL 905 (900 + clockTolerance), ngắt socket của phiên SAU commit', async () => {
    const alice = await h.seedUser();
    const s1 = await h.seedSession(alice);
    const s2 = await h.seedSession(alice);
    await logout.execute({ refreshToken: s1.refreshToken });
    const rows = await h.refreshTokens.rows();
    expect(rows.find((r) => r.familyId === s1.familyId)?.revokedReason).toBe('LOGOUT');
    expect(rows.find((r) => r.familyId === s2.familyId)?.revokedAt).toBeNull();
    expect(h.store.revokedSessions.get(s1.familyId)).toBe(905);
    expect(h.notifier.calls).toEqual([
      { method: 'disconnectSession', args: [s1.familyId], duringTransaction: false },
    ]);
  });

  it('OUT-02: không có token / token lạ ⇒ thành công im lặng, không ghi gì (idempotent)', async () => {
    await expect(logout.execute({ refreshToken: undefined })).resolves.toBeUndefined();
    await expect(logout.execute({ refreshToken: 'unknown-token' })).resolves.toBeUndefined();
    expect(h.uow.steps).toEqual([]);
    expect(h.store.ops).toEqual([]);
  });

  it('OUT-02: logout lần hai cùng token vẫn thành công', async () => {
    const s1 = await h.seedSession(await h.seedUser());
    await logout.execute({ refreshToken: s1.refreshToken });
    await expect(logout.execute({ refreshToken: s1.refreshToken })).resolves.toBeUndefined();
  });

  it('ADR-105 (fail-closed): Valkey lỗi khi ghi sid-revoked ⇒ 503 + rollback, family KHÔNG bị thu hồi, không ngắt socket', async () => {
    const s1 = await h.seedSession(await h.seedUser());
    h.store.failing = true;
    await expect(logout.execute({ refreshToken: s1.refreshToken })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    expect((await h.refreshTokens.rows())[0]?.revokedAt).toBeNull();
    expect(h.uow.rollbacks).toBe(1);
    expect(h.notifier.calls).toEqual([]);
  });

  it('ADR-105: ghi sid-revoked TRƯỚC commit và ghi lại SAU commit', async () => {
    const s1 = await h.seedSession(await h.seedUser());
    await logout.execute({ refreshToken: s1.refreshToken });
    expect(h.store.ops).toEqual([
      { op: 'revokeSession', sid: s1.familyId, ttlSeconds: 905 },
      { op: 'revokeSession', sid: s1.familyId, ttlSeconds: 905 },
    ]);
  });
});
