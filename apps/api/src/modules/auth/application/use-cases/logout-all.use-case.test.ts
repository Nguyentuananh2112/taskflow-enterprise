import { beforeEach, describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../../../../core/errors';
import { createAuthHarness, type AuthHarness } from '../../testing/auth-harness';
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

    expect(h.users.rows().find((u) => u.id === alice.id)?.tokenVersion).toBe(1);
    const reasons = h.refreshTokens.rows().map((r) => [r.userId === alice.id, r.revokedReason]);
    expect(reasons.filter(([mine]) => mine).every(([, r]) => r === 'LOGOUT_ALL')).toBe(true);
    expect(reasons.filter(([mine]) => !mine).every(([, r]) => r === null)).toBe(true);
    expect(h.store.ops).toEqual([{ op: 'setTokenVersion', userId: alice.id, tokenVersion: 1 }]);
    expect(h.notifier.calls).toEqual([
      { method: 'disconnectUser', args: [alice.id], duringTransaction: false },
    ]);
    expect(h.events.types()).toEqual(['UserSessionsRevoked']);
  });

  it('ALL-04: Valkey lỗi khi ghi tv ⇒ vẫn thành công (DB là nguồn sự thật), có log cảnh báo', async () => {
    const alice = await h.seedUser();
    h.store.failing = true;
    await expect(logoutAll.execute({ userId: alice.id })).resolves.toBeUndefined();
    expect(h.users.rows()[0]?.tokenVersion).toBe(1);
    expect(h.logger.messages('warn')).toContain('auth.session_cache_write_failed');
    expect(h.notifier.calls).toHaveLength(1); // vẫn ngắt socket
  });

  it('user không tồn tại (token hợp lệ nhưng user đã bị xóa cứng) ⇒ 401', async () => {
    await expect(logoutAll.execute({ userId: 'ghost' })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
