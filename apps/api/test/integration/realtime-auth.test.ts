// Handshake Socket.io với AccessTokenAuthenticator THẬT của module auth (JWT jose, kiểm tv/sid —
// security §2.5, SEC-35). Đặt ở test/ vì code trong src/core không được import module.
import { afterEach, describe, expect, it } from 'vitest';

import { AccessTokenAuthenticator } from '../../src/modules/auth/application/access-token-authenticator';
import {
  createAuthHarness,
  signWithForeignSecret,
  type AuthHarness,
} from '../../src/modules/auth/testing/auth-harness';
import { socketAuthenticatorFrom } from '../../src/core/realtime/ports';
import { connectError, connected, startRealtime } from '../support/realtime';

let rt: Awaited<ReturnType<typeof startRealtime>> | undefined;
afterEach(async () => rt?.close());

async function setup() {
  const h: AuthHarness = createAuthHarness();
  const authenticator = socketAuthenticatorFrom(
    new AccessTokenAuthenticator({
      accessTokens: h.accessTokens,
      store: h.store,
      users: h.users,
      refreshTokens: h.refreshTokens,
      logger: h.logger,
      clock: h.clock,
    }),
  );
  rt = await startRealtime({ authenticator });
  const user = await h.seedUser();
  const session = await h.seedSession(user);
  return { h, rt, user, session };
}

describe('handshake với access token thật', () => {
  it('token hợp lệ ⇒ kết nối; principal lấy từ claims (sub, sid, exp)', async () => {
    const { rt: r, user, session } = await setup();
    await connected(r.client({ token: session.accessToken }));
    const [socket] = await r.gateway.io.fetchSockets();
    expect(socket?.data.userId).toBe(user.id);
    expect(socket?.data.sid).toBe(session.familyId);
    expect(socket?.data.expiresAt.getTime()).toBeGreaterThan(
      Date.parse('2026-11-01T00:00:00.000Z'),
    );
  });

  it('token hết hạn ⇒ connect_error TOKEN_EXPIRED', async () => {
    const { h, rt: r, session } = await setup();
    h.clock.advance(16 * 60_000);
    expect((await connectError(r.client({ token: session.accessToken }))).code).toBe(
      'TOKEN_EXPIRED',
    );
  });

  it('chữ ký sai (secret khác) ⇒ UNAUTHORIZED', async () => {
    const { h, rt: r } = await setup();
    expect((await connectError(r.client({ token: await signWithForeignSecret(h) }))).code).toBe(
      'UNAUTHORIZED',
    );
  });

  it('tv cũ (sau logout-all / đổi mật khẩu) ⇒ UNAUTHORIZED', async () => {
    const { h, rt: r, user, session } = await setup();
    await h.store.setTokenVersion(user.id, 1);
    expect((await connectError(r.client({ token: session.accessToken }))).code).toBe(
      'UNAUTHORIZED',
    );
  });

  it('phiên đã logout (sid bị thu hồi) ⇒ UNAUTHORIZED', async () => {
    const { h, rt: r, session } = await setup();
    await h.store.revokeSession(session.familyId, 900);
    expect((await connectError(r.client({ token: session.accessToken }))).code).toBe(
      'UNAUTHORIZED',
    );
  });
});
