import { decodeJwt } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  InvalidCurrentPasswordError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '../../../../core/errors';
import {
  type AuthHarness,
  createAuthHarness,
  GHOST_ID,
  META,
  PASSWORD,
} from '../../testing/auth-harness';
import { User } from '../../domain/user';
import { ChangePasswordUseCase } from './change-password.use-case';

let h: AuthHarness;
let change: ChangePasswordUseCase;
const NEW_PASSWORD = 'brand-new-passphrase-7';
const codes = (err: unknown) =>
  (err as ValidationError).issues.map((i) => `${i.path.join('.')}:${i.code}`);

beforeEach(() => {
  h = createAuthHarness();
  change = new ChangePasswordUseCase(h);
});

describe('ChangePasswordUseCase (security.md 1.7)', () => {
  it('PWD-01: hash mới, passwordChangedAt, tv + 1, mọi token cũ PASSWORD_CHANGED, family MỚI cho thiết bị hiện tại', async () => {
    const alice = await h.seedUser();
    const s1 = await h.seedSession(alice);
    const s2 = await h.seedSession(alice);
    h.clock.advance(60_000);

    const result = await change.execute({
      userId: alice.id,
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      meta: META,
    });

    const user = (await h.users.rows())[0];
    expect(user).toMatchObject({
      passwordHash: `h:${NEW_PASSWORD}`,
      passwordChangedAt: h.clock.now(),
      tokenVersion: 1,
    });
    const old = (await h.refreshTokens.rows()).filter((r) =>
      [s1.familyId, s2.familyId].includes(r.familyId),
    );
    expect(old.map((r) => r.revokedReason)).toEqual(['PASSWORD_CHANGED', 'PASSWORD_CHANGED']);
    expect(result.session.familyId).not.toBe(s1.familyId);
    expect(
      (await h.refreshTokens.rows()).find((r) => r.familyId === result.session.familyId)?.revokedAt,
    ).toBeNull();
    expect(decodeJwt(result.session.accessToken)).toMatchObject({
      tv: 1,
      sid: result.session.familyId,
    });
    expect(h.store.ops).toEqual([
      { op: 'setTokenVersion', userId: alice.id, tokenVersion: 1 }, // TRƯỚC commit (ADR-105)
      { op: 'setTokenVersion', userId: alice.id, tokenVersion: 1 }, // ghi lại SAU commit
    ]);
    expect(h.notifier.calls).toEqual([
      { method: 'disconnectUser', args: [alice.id], duringTransaction: false },
    ]);
    expect(h.events.types()).toEqual(['UserPasswordChanged']);
  });

  it('PWD-02: sai mật khẩu hiện tại ⇒ 400 INVALID_CURRENT_PASSWORD, không đổi gì', async () => {
    const alice = await h.seedUser();
    await h.seedSession(alice);
    const before = { users: await h.users.rows(), tokens: await h.refreshTokens.rows() };
    await expect(
      change.execute({
        userId: alice.id,
        currentPassword: 'not-my-password',
        newPassword: NEW_PASSWORD,
        meta: META,
      }),
    ).rejects.toBeInstanceOf(InvalidCurrentPasswordError);
    expect({ users: await h.users.rows(), tokens: await h.refreshTokens.rows() }).toEqual(before);
    expect(h.notifier.calls).toEqual([]);
  });

  it('PWD-03: mật khẩu mới trùng mật khẩu hiện tại (kể cả khác dạng NFC/NFD) ⇒ 400', async () => {
    const vi = 'mật-khẩu-tiếng-việt-1';
    const alice = await h.seedUser();
    const err1 = await change
      .execute({ userId: alice.id, currentPassword: PASSWORD, newPassword: PASSWORD, meta: META })
      .catch((e: unknown) => e);
    expect(err1).toBeInstanceOf(ValidationError);
    expect(codes(err1)).toEqual(['newPassword:same_as_current']);
    // Đổi sang mật khẩu có dấu, rồi thử "đổi" sang chính nó ở dạng NFD:
    await change.execute({
      userId: alice.id,
      currentPassword: PASSWORD,
      newPassword: vi,
      meta: META,
    });
    const err2 = await change
      .execute({
        userId: alice.id,
        currentPassword: vi,
        newPassword: vi.normalize('NFD'),
        meta: META,
      })
      .catch((e: unknown) => e);
    expect(codes(err2)).toEqual(['newPassword:same_as_current']);
  });

  it('PWD-04: mật khẩu mới 11 ký tự / phổ biến ⇒ 400 (path newPassword)', async () => {
    const alice = await h.seedUser();
    const short = await change
      .execute({
        userId: alice.id,
        currentPassword: PASSWORD,
        newPassword: 'a'.repeat(11),
        meta: META,
      })
      .catch((e: unknown) => e);
    expect(codes(short)).toEqual(['newPassword:too_small']);
    const common = await change
      .execute({
        userId: alice.id,
        currentPassword: PASSWORD,
        newPassword: 'password123456',
        meta: META,
      })
      .catch((e: unknown) => e);
    expect(codes(common)).toEqual(['newPassword:common_password']);
  });

  it('PWD-07: hash() mật khẩu mới gọi TRƯỚC begin (không trong transaction)', async () => {
    const alice = await h.seedUser();
    await change.execute({
      userId: alice.id,
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      meta: META,
    });
    expect(h.hasher.calls.filter((c) => c.method === 'hash')).toEqual([
      { method: 'hash', inTransaction: false },
    ]);
  });

  it('user không tồn tại / đã xóa ⇒ 401', async () => {
    const gone = await h.seedUser('gone@example.com', { deleted: true });
    await expect(
      change.execute({
        userId: GHOST_ID,
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        meta: META,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      change.execute({
        userId: gone.id,
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        meta: META,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('F3 B-3: user bị xóa mềm SAU khi verify + băm (ngoài transaction) ⇒ 401, hash / tv / token không đổi', async () => {
    const alice = await h.seedUser();
    await h.seedSession(alice);
    const findById = h.users.findById.bind(h.users);
    let reads = 0;
    // Lần đọc thứ 2 là lần đọc lại TRONG transaction — lúc đó user đã bị xóa mềm.
    h.users.findById = async (id) => {
      const user = await findById(id);
      reads += 1;
      return reads === 2 && user
        ? User.reconstitute({ ...user.toSnapshot(), deletedAt: h.clock.now() })
        : user;
    };
    await expect(
      change.execute({
        userId: alice.id,
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        meta: META,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(reads).toBe(2);
    expect((await h.users.rows())[0]).toMatchObject({
      passwordHash: `h:${PASSWORD}`,
      tokenVersion: 0,
    });
    expect((await h.refreshTokens.rows()).every((r) => r.revokedAt === null)).toBe(true);
    expect(h.store.ops).toEqual([]);
  });

  it('ADR-105 (fail-closed): Valkey lỗi khi ghi tv mới ⇒ 503 + rollback: mật khẩu cũ vẫn dùng được, token không bị thu hồi', async () => {
    const alice = await h.seedUser();
    await h.seedSession(alice);
    h.store.failing = true;
    await expect(
      change.execute({
        userId: alice.id,
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        meta: META,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect((await h.users.rows())[0]).toMatchObject({
      passwordHash: `h:${PASSWORD}`,
      tokenVersion: 0,
      passwordChangedAt: null,
    });
    expect((await h.refreshTokens.rows()).every((r) => r.revokedAt === null)).toBe(true);
    expect(h.notifier.calls).toEqual([]);
  });

  it('ADR-104: mật khẩu bị đổi bởi request khác giữa lúc verify và UPDATE ⇒ 400 INVALID_CURRENT_PASSWORD, không đổi gì', async () => {
    const alice = await h.seedUser();
    const original = h.users.changePassword.bind(h.users);
    h.users.changePassword = async (input) => {
      await original({ ...input, newHash: 'h:changed-elsewhere-1' }); // request kia thắng trước
      return original(input); // điều kiện password_hash = oldHash không còn đúng
    };
    await expect(
      change.execute({
        userId: alice.id,
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        meta: META,
      }),
    ).rejects.toBeInstanceOf(InvalidCurrentPasswordError);
    expect(h.uow.rollbacks).toBe(1);
    expect((await h.users.rows())[0]?.passwordHash).toBe(`h:${PASSWORD}`);
  });
});
