// T-028 (ASVS V16, security.md §6.7): sự kiện bảo mật của auth được ghi log — có userId/ip để điều tra,
// KHÔNG có email, mật khẩu hay token; chỉ ghi sau commit (rollback ⇒ không có sự kiện).
import { beforeEach, describe, expect, it } from 'vitest';

import { InvalidCredentialsError, InvalidCurrentPasswordError } from '../../../../core/errors';
import { type AuthHarness, createAuthHarness, META, PASSWORD } from '../../testing/auth-harness';
import { ChangePasswordUseCase } from './change-password.use-case';
import { LoginUseCase } from './login.use-case';
import { LogoutAllUseCase } from './logout-all.use-case';

let h: AuthHarness;
beforeEach(() => {
  h = createAuthHarness();
});

const WRONG_GUESS = ['wrong', 'guess', '123'].join('-'); // không phải secret — tránh mẫu gitleaks
const event = (msg: string) => h.logger.entries.filter((e) => e.msg === msg);

describe('auth.login_failed', () => {
  it('sai mật khẩu ⇒ warn có userId + ip, không có email/mật khẩu', async () => {
    const alice = await h.seedUser('alice@example.com');
    await expect(
      new LoginUseCase(h).execute({
        email: 'alice@example.com',
        password: WRONG_GUESS,
        meta: META,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(event('auth.login_failed')).toEqual([
      expect.objectContaining({ level: 'warn', data: { userId: alice.id, ip: META.ip } }),
    ]);
    const all = JSON.stringify(h.logger.entries);
    expect(all).not.toContain('alice@example.com');
    expect(all).not.toContain(WRONG_GUESS);
  });

  it('email không tồn tại / sai định dạng ⇒ userId null, không ghi email', async () => {
    for (const email of ['ghost@example.com', 'not-an-email']) {
      await expect(
        new LoginUseCase(h).execute({ email, password: PASSWORD, meta: META }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    expect(event('auth.login_failed').map((e) => e.data)).toEqual([
      { userId: null, ip: META.ip },
      { userId: null, ip: META.ip },
    ]);
    expect(JSON.stringify(h.logger.entries)).not.toMatch(/ghost@|not-an-email/);
  });

  it('đăng nhập đúng ⇒ không có sự kiện thất bại', async () => {
    await h.seedUser('alice@example.com');
    await new LoginUseCase(h).execute({
      email: 'alice@example.com',
      password: PASSWORD,
      meta: META,
    });
    expect(event('auth.login_failed')).toEqual([]);
  });
});

describe('auth.logout_all / auth.password_changed', () => {
  it('logout-all ⇒ info { userId }', async () => {
    const alice = await h.seedUser();
    await new LogoutAllUseCase(h).execute({ userId: alice.id });
    expect(event('auth.logout_all')).toEqual([
      expect.objectContaining({ level: 'info', data: { userId: alice.id } }),
    ]);
  });

  it('đổi mật khẩu ⇒ info { userId, ip }, không có mật khẩu; sai mật khẩu hiện tại ⇒ không có sự kiện', async () => {
    const alice = await h.seedUser();
    const change = new ChangePasswordUseCase(h);
    await expect(
      change.execute({
        userId: alice.id,
        currentPassword: WRONG_GUESS,
        newPassword: 'x'.repeat(14),
        meta: META,
      }),
    ).rejects.toBeInstanceOf(InvalidCurrentPasswordError);
    expect(event('auth.password_changed')).toEqual([]);

    const newPassword = 'brand-new-passphrase-9';
    await change.execute({ userId: alice.id, currentPassword: PASSWORD, newPassword, meta: META });
    expect(event('auth.password_changed')).toEqual([
      expect.objectContaining({ level: 'info', data: { userId: alice.id, ip: META.ip } }),
    ]);
    expect(JSON.stringify(h.logger.entries)).not.toContain(newPassword);
  });
});
