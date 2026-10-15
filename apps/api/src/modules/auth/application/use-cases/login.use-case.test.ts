import { decodeJwt } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import { InvalidCredentialsError } from '../../../../core/errors';
import {
  createAuthHarness,
  META,
  NOW,
  PASSWORD,
  type AuthHarness,
} from '../../testing/auth-harness';
import { FakePasswordHasher } from '../../testing/fakes';
import { LoginUseCase } from './login.use-case';

let h: AuthHarness;
let login: LoginUseCase;
const LATER = '2026-11-05T00:00:00.000Z';

beforeEach(() => {
  h = createAuthHarness();
  login = new LoginUseCase(h);
});

describe('LoginUseCase', () => {
  it('LOG-01: đăng nhập đúng ⇒ family mới, lastLoginAt = now, tv = tokenVersion của user', async () => {
    const alice = await h.seedUser('alice@example.com', { tokenVersion: 4 });
    h.clock.set(LATER);
    const result = await login.execute({
      email: 'alice@example.com',
      password: PASSWORD,
      meta: META,
    });
    expect(h.users.rows()[0]?.lastLoginAt).toEqual(new Date(LATER));
    expect(h.refreshTokens.rows()).toEqual([
      expect.objectContaining({ userId: alice.id, familyId: result.session.familyId }),
    ]);
    expect(decodeJwt(result.session.accessToken)).toMatchObject({ sub: alice.id, tv: 4 });
    expect(result.user).toEqual({
      id: alice.id,
      email: 'alice@example.com',
      fullName: 'Alice Nguyen',
      createdAt: new Date(NOW),
    });
  });

  it('LOG-02: email được chuẩn hóa khi tra', async () => {
    await h.seedUser();
    await expect(
      login.execute({ email: ' ALICE@example.com', password: PASSWORD, meta: META }),
    ).resolves.toBeDefined();
  });

  it('LOG-03: sai mật khẩu ⇒ 401, không tạo refresh token, lastLoginAt không đổi', async () => {
    await h.seedUser();
    const error = await login
      .execute({ email: 'alice@example.com', password: 'wrong-password-1', meta: META })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidCredentialsError);
    expect(h.refreshTokens.rows()).toEqual([]);
    expect(h.users.rows()[0]?.lastLoginAt).toBeNull();
    expect(h.uow.steps).toEqual([]);
  });

  it('LOG-04: email không tồn tại ⇒ cùng lỗi + message với LOG-03, đã verify với DUMMY_HASH đúng 1 lần', async () => {
    await h.seedUser();
    const wrongPw = await login
      .execute({ email: 'alice@example.com', password: 'wrong-password-1', meta: META })
      .catch((e: unknown) => e);
    h.hasher.calls.length = 0;
    const ghost = await login
      .execute({ email: 'ghost@example.com', password: PASSWORD, meta: META })
      .catch((e: unknown) => e);
    expect(ghost).toBeInstanceOf(InvalidCredentialsError);
    expect((ghost as Error).message).toBe((wrongPw as Error).message);
    expect(h.hasher.calls).toEqual([
      { method: 'verify', hashed: FakePasswordHasher.DUMMY, inTransaction: false },
    ]);
  });

  it('LOG-04: email sai định dạng cũng xử lý như không tồn tại (vẫn verify giả)', async () => {
    await expect(
      login.execute({ email: 'not-an-email', password: PASSWORD, meta: META }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(h.hasher.calls).toEqual([
      { method: 'verify', hashed: FakePasswordHasher.DUMMY, inTransaction: false },
    ]);
  });

  it('LOG-05: user đã xóa (deletedAt) ⇒ 401 giống LOG-03, dù đúng mật khẩu', async () => {
    await h.seedUser('alice@example.com', { deleted: true });
    await expect(
      login.execute({ email: 'alice@example.com', password: PASSWORD, meta: META }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(h.hasher.calls.at(-1)).toMatchObject({ hashed: FakePasswordHasher.DUMMY });
  });

  it('LOG-06: needsRehash ⇒ băm lại NGOÀI transaction và lưu; không thì giữ nguyên hash', async () => {
    await h.seedUser();
    await login.execute({ email: 'alice@example.com', password: PASSWORD, meta: META });
    expect(h.hasher.calls.filter((c) => c.method === 'hash')).toEqual([]);
    h.hasher.rehashNeeded = true;
    await login.execute({ email: 'alice@example.com', password: PASSWORD, meta: META });
    expect(h.hasher.calls.filter((c) => c.method === 'hash')).toEqual([
      { method: 'hash', inTransaction: false },
    ]);
    expect(h.users.rows()[0]?.passwordHash).toBe(`h:${PASSWORD}`);
  });

  it('LOG-07: payload access token đúng claims, TTL 900, không role/workspace/email', async () => {
    await h.seedUser();
    const { session } = await login.execute({
      email: 'alice@example.com',
      password: PASSWORD,
      meta: META,
    });
    const payload = decodeJwt(session.accessToken);
    expect(Object.keys(payload).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'jti',
      'sid',
      'sub',
      'tv',
    ]);
    expect(payload).toMatchObject({ iss: 'taskflow-api', aud: 'taskflow-web' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);
  });
});
