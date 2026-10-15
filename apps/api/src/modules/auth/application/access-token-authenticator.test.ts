import { beforeEach, describe, expect, it } from 'vitest';

import {
  ServiceUnavailableError,
  TokenExpiredError,
  UnauthorizedError,
} from '../../../core/errors';
import {
  createAuthHarness,
  signWithForeignSecret,
  type AuthHarness,
} from '../testing/auth-harness';
import { AccessTokenAuthenticator } from './access-token-authenticator';

let h: AuthHarness;
let auth: AccessTokenAuthenticator;

beforeEach(() => {
  h = createAuthHarness();
  auth = new AccessTokenAuthenticator(h);
});

async function signedIn(tokenVersion = 0) {
  const alice = await h.seedUser('alice@example.com', { tokenVersion });
  const session = await h.seedSession(alice);
  return { alice, session, header: `Bearer ${session.accessToken}` };
}

const reject = (header: string | undefined) =>
  auth.authenticate(header).then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );

describe('AccessTokenAuthenticator (security.md 2.5)', () => {
  it('MW-08: token hợp lệ ⇒ { id, sid, tv }; cache đọc đúng 1 lần (MGET), miss ⇒ DB rồi SET NX', async () => {
    const { alice, session, header } = await signedIn(2);
    expect(await auth.authenticate(header)).toEqual({ id: alice.id, sid: session.familyId, tv: 2 });
    expect(h.store.ops).toEqual([
      { op: 'read', userId: alice.id, sid: session.familyId },
      { op: 'primeTokenVersion', userId: alice.id, tokenVersion: 2 },
    ]);
    h.store.ops.length = 0;
    await auth.authenticate(header);
    expect(h.store.ops).toEqual([{ op: 'read', userId: alice.id, sid: session.familyId }]);
  });

  it('chấp nhận scheme "bearer" không phân biệt hoa thường', async () => {
    const { session } = await signedIn();
    await expect(auth.authenticate(`bearer ${session.accessToken}`)).resolves.toBeDefined();
  });

  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer  ', 'Token abc'])(
    'MW-01: header %j ⇒ 401 UNAUTHORIZED',
    async (header) => {
      expect(await reject(header)).toBeInstanceOf(UnauthorizedError);
      expect(h.store.ops).toEqual([]);
    },
  );

  it('MW-02: chữ ký sai / alg none / sai secret ⇒ 401 UNAUTHORIZED (không phải TOKEN_EXPIRED)', async () => {
    const { session } = await signedIn();
    const tampered = `${session.accessToken.slice(0, -4)}AAAA`;
    const err = await reject(`Bearer ${tampered}`);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err).not.toBeInstanceOf(TokenExpiredError);
    const foreign = await signWithForeignSecret(h);
    expect(await reject(`Bearer ${foreign}`)).not.toBeInstanceOf(TokenExpiredError);
  });

  it('MW-03: hết hạn 6s trước ⇒ TOKEN_EXPIRED; 4s trước ⇒ qua (tolerance 5s)', async () => {
    const { header } = await signedIn();
    h.clock.advance((900 + 4) * 1000);
    await expect(auth.authenticate(header)).resolves.toBeDefined();
    h.clock.advance(2000);
    expect(await reject(header)).toBeInstanceOf(TokenExpiredError);
  });

  it('MW-04: tv trong cache (2) khác tv trong token (1) ⇒ 401', async () => {
    const { alice, header } = await signedIn(1);
    h.store.tokenVersions.set(alice.id, 2);
    expect(await reject(header)).toBeInstanceOf(UnauthorizedError);
  });

  it('MW-05: sid đã bị thu hồi trong cache ⇒ 401', async () => {
    const { session, header } = await signedIn();
    h.store.revokedSessions.set(session.familyId, 900);
    expect(await reject(header)).toBeInstanceOf(UnauthorizedError);
  });

  it('MW-06: cache lỗi ⇒ fallback DB: tv khác ⇒ 401; tv khớp ⇒ qua; có log cảnh báo', async () => {
    const { alice, header } = await signedIn(1);
    h.store.failing = true;
    await expect(auth.authenticate(header)).resolves.toMatchObject({ id: alice.id, tv: 1 });
    expect(h.logger.messages('warn')).toContain('auth.session_cache_unavailable');
    const user = await h.users.findById(alice.id);
    user?.revokeAllSessions(h.clock.now());
    if (user) await h.users.save(user);
    expect(await reject(header)).toBeInstanceOf(UnauthorizedError);
  });

  it('MW-06: cache lỗi ⇒ fallback DB cho sid đã LOGOUT ⇒ 401', async () => {
    const { session, header } = await signedIn();
    await h.refreshTokens.revokeFamily(session.familyId, 'LOGOUT', h.clock.now());
    h.store.failing = true;
    expect(await reject(header)).toBeInstanceOf(UnauthorizedError);
  });

  it('MW-07: cache lỗi VÀ DB lỗi ⇒ 503 SERVICE_UNAVAILABLE', async () => {
    const { header } = await signedIn();
    h.store.failing = true;
    h.users.getTokenVersion = () => Promise.reject(new Error('db down'));
    expect(await reject(header)).toBeInstanceOf(ServiceUnavailableError);
  });

  it('cache miss VÀ DB lỗi ⇒ 503', async () => {
    const { header } = await signedIn();
    h.users.getTokenVersion = () => Promise.reject(new Error('db down'));
    expect(await reject(header)).toBeInstanceOf(ServiceUnavailableError);
  });

  it('cache miss, user đã xóa (DB trả null) ⇒ 401, không SET NX', async () => {
    const { alice, header } = await signedIn();
    h.users.getTokenVersion = () => Promise.resolve(null);
    expect(await reject(header)).toBeInstanceOf(UnauthorizedError);
    expect(h.store.ops.map((o) => o.op)).toEqual(['read']);
    expect(h.store.tokenVersions.has(alice.id)).toBe(false);
  });

  it('SET NX lỗi sau khi đã đọc DB thành công ⇒ vẫn qua, có log', async () => {
    const { header } = await signedIn();
    h.store.primeTokenVersion = () => Promise.reject(new Error('valkey write failed'));
    await expect(auth.authenticate(header)).resolves.toBeDefined();
    expect(h.logger.messages('warn')).toContain('auth.session_cache_write_failed');
  });
});
