import { beforeEach, describe, expect, it } from 'vitest';

import { ServiceUnavailableError, UnauthorizedError } from '../../../../core/errors';
import { type AuthHarness, createAuthHarness, GHOST_ID } from '../../testing/auth-harness';
import { AccessTokenAuthenticator } from '../access-token-authenticator';
import { LogoutAllUseCase } from './logout-all.use-case';

let h: AuthHarness;
let logoutAll: LogoutAllUseCase;

beforeEach(() => {
  h = createAuthHarness();
  logoutAll = new LogoutAllUseCase(h);
});

describe('LogoutAllUseCase (security.md 1.6, ADR-025)', () => {
  it('ALL-01: tokenVersion + 1; mọi token LOGOUT_ALL; cache tv, ngắt socket, publish event — đều SAU commit', async () => {
    const alice = await h.seedUser();
    await h.seedSession(alice);
    await h.seedSession(alice);
    await h.seedSession(alice);
    const bob = await h.seedUser('bob@example.com');
    await h.seedSession(bob);

    await logoutAll.execute({ userId: alice.id });

    expect((await h.users.rows()).find((u) => u.id === alice.id)?.tokenVersion).toBe(1);
    const reasons = (await h.refreshTokens.rows()).map((r) => [
      r.userId === alice.id,
      r.revokedReason,
    ]);
    expect(reasons.filter(([mine]) => mine).every(([, r]) => r === 'LOGOUT_ALL')).toBe(true);
    expect(reasons.filter(([mine]) => !mine).every(([, r]) => r === null)).toBe(true);
    expect(h.store.ops).toEqual([
      { op: 'setTokenVersion', userId: alice.id, tokenVersion: 1 }, // TRƯỚC commit (ADR-105)
      { op: 'setTokenVersion', userId: alice.id, tokenVersion: 1 }, // ghi lại SAU commit
    ]);
    expect(h.notifier.calls).toEqual([
      { method: 'disconnectUser', args: [alice.id], duringTransaction: false },
    ]);
    expect(h.events.types()).toEqual(['UserSessionsRevoked']);
  });

  it('ALL-04 (ADR-105, fail-closed): Valkey lỗi khi ghi tv ⇒ 503 + rollback: tv, token, socket, event đều không đổi', async () => {
    const alice = await h.seedUser();
    await h.seedSession(alice);
    h.store.failing = true;
    await expect(logoutAll.execute({ userId: alice.id })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    expect((await h.users.rows())[0]?.tokenVersion).toBe(0);
    expect((await h.refreshTokens.rows()).every((r) => r.revokedAt === null)).toBe(true);
    expect(h.uow.rollbacks).toBe(1);
    expect(h.notifier.calls).toEqual([]);
    expect(h.events.published).toEqual([]);
  });

  it('F3 B-2: user bị xóa giữa lúc đọc và bumpTokenVersion (trả null) ⇒ 401 + rollback: không ghi tv, không thu hồi, không phát gì', async () => {
    const alice = await h.seedUser();
    await h.seedSession(alice);
    h.users.bumpTokenVersion = () => Promise.resolve(null);
    await expect(logoutAll.execute({ userId: alice.id })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(h.store.ops).toEqual([]);
    expect((await h.refreshTokens.rows()).every((r) => r.revokedAt === null)).toBe(true);
    expect(h.uow.rollbacks).toBe(1);
    expect(h.notifier.calls).toEqual([]);
    expect(h.events.published).toEqual([]);
  });

  it('ALL-05 (ADR-105, SEC-24d): ghi tv TRƯỚC commit thành công, ghi lại SAU commit lỗi ⇒ logout-all vẫn xong, giá trị thu hồi còn, access cũ 401', async () => {
    const alice = await h.seedUser();
    const session = await h.seedSession(alice);
    const write = h.store.setTokenVersion.bind(h.store);
    let calls = 0;
    h.store.setTokenVersion = (userId, tv) => {
      calls += 1;
      return calls === 1 ? write(userId, tv) : Promise.reject(new Error('valkey down'));
    };

    await expect(logoutAll.execute({ userId: alice.id })).resolves.toBeUndefined();

    expect(calls).toBe(2); // trước commit + ghi lại sau commit
    expect(h.uow.rollbacks).toBe(0);
    expect(h.store.tokenVersions.get(alice.id)).toBe(1); // giá trị ghi TRƯỚC commit vẫn còn
    expect(h.logger.messages('warn')).toContain('auth.session_cache_write_failed');
    expect(h.notifier.calls).toEqual([
      { method: 'disconnectUser', args: [alice.id], duringTransaction: false },
    ]);
    await expect(
      new AccessTokenAuthenticator(h).authenticate(`Bearer ${session.accessToken}`),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('user không tồn tại (token hợp lệ nhưng user đã bị xóa cứng) ⇒ 401', async () => {
    await expect(logoutAll.execute({ userId: GHOST_ID })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
