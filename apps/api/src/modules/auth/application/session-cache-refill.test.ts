// X3 (T-032, cross-read của F): Valkey không persistence — restart xóa mọi `auth:sid-revoked:*`.
// Phiên đã đăng xuất 1 thiết bị / bị reuse-detected KHÔNG được sống lại sau đó.
import { beforeEach, describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../../../core/errors';
import { type AuthHarness, createAuthHarness } from '../testing/auth-harness';
import { AccessTokenAuthenticator } from './access-token-authenticator';
import { LogoutUseCase } from './use-cases/logout.use-case';

let h: AuthHarness;
let auth: AccessTokenAuthenticator;
beforeEach(() => {
  h = createAuthHarness();
  auth = new AccessTokenAuthenticator(h);
});

/** Valkey restart: mất toàn bộ khóa. */
const wipeCache = () => {
  h.store.tokenVersions.clear();
  h.store.revokedSessions.clear();
};
const bearer = (token: string) => `Bearer ${token}`;

describe('cache miss sau khi Valkey mất dữ liệu (X3)', () => {
  it('phiên đã logout ⇒ cache trống ⇒ vẫn 401 (kiểm sid trong DB, không chỉ tv)', async () => {
    const alice = await h.seedUser();
    const s1 = await h.seedSession(alice);
    await new LogoutUseCase(h).execute({ refreshToken: s1.refreshToken });
    wipeCache();
    await expect(auth.authenticate(bearer(s1.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('phiên KHÁC của cùng user nạp lại tv trước ⇒ phiên đã logout vẫn 401 (sid-revoked được khôi phục cùng lúc)', async () => {
    const alice = await h.seedUser();
    const revoked = await h.seedSession(alice);
    const live = await h.seedSession(alice);
    await new LogoutUseCase(h).execute({ refreshToken: revoked.refreshToken });
    wipeCache();

    await expect(auth.authenticate(bearer(live.accessToken))).resolves.toMatchObject({
      id: alice.id,
    });
    expect(h.store.tokenVersions.has(alice.id)).toBe(true); // lần sau sẽ TRÚNG cache tv
    expect(h.store.revokedSessions.get(revoked.familyId)).toBeGreaterThan(0);
    await expect(auth.authenticate(bearer(revoked.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('TTL sid-revoked khôi phục = phần còn lại của cửa sổ 905s (TTL + clockTolerance); phiên thu hồi quá cửa sổ ⇒ không khôi phục', async () => {
    const alice = await h.seedUser();
    const old = await h.seedSession(alice);
    await new LogoutUseCase(h).execute({ refreshToken: old.refreshToken });
    h.clock.advance(901_000);
    const recent = await h.seedSession(alice);
    await new LogoutUseCase(h).execute({ refreshToken: recent.refreshToken });
    h.clock.advance(300_000);
    const live = await h.seedSession(alice);
    wipeCache();

    await auth.authenticate(bearer(live.accessToken));
    expect(h.store.revokedSessions.has(old.familyId)).toBe(false);
    expect(h.store.revokedSessions.get(recent.familyId)).toBe(605);
  });

  it('F3 B-8: biên cửa sổ — thu hồi đúng 905 s trước (TTL còn 0) ⇒ KHÔNG khôi phục; 904 s trước ⇒ khôi phục với TTL 1', async () => {
    const alice = await h.seedUser();
    const atEdge = await h.seedSession(alice);
    await new LogoutUseCase(h).execute({ refreshToken: atEdge.refreshToken });
    h.clock.advance(1_000);
    const inside = await h.seedSession(alice);
    await new LogoutUseCase(h).execute({ refreshToken: inside.refreshToken });
    h.clock.advance(904_000); // atEdge: đúng 905 s; inside: 904 s
    const live = await h.seedSession(alice);
    wipeCache();

    await auth.authenticate(bearer(live.accessToken));
    expect(h.store.revokedSessions.has(atEdge.familyId)).toBe(false); // không ghi TTL 0 (= không hết hạn)
    expect(h.store.revokedSessions.get(inside.familyId)).toBe(1);
  });

  it('khôi phục sid-revoked lỗi ⇒ KHÔNG nạp tv (lần sau vẫn hỏi DB)', async () => {
    const alice = await h.seedUser();
    const revoked = await h.seedSession(alice);
    const live = await h.seedSession(alice);
    await new LogoutUseCase(h).execute({ refreshToken: revoked.refreshToken });
    wipeCache();
    h.store.revokeSession = () => Promise.reject(new Error('valkey down'));

    await expect(auth.authenticate(bearer(live.accessToken))).resolves.toMatchObject({
      id: alice.id,
    });
    expect(h.store.tokenVersions.has(alice.id)).toBe(false);
    await expect(auth.authenticate(bearer(revoked.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
