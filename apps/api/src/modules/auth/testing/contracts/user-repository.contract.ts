// Contract test dùng chung (QA F, T-017 §B.4): chạy cho InMemory (unit) và Prisma/Valkey (integration).
import { T0, T1, newUser, type AuthPersistence } from './fixtures';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EmailAlreadyExistsError } from '../../../../core/errors';
import { Email } from '../../domain/email';

export function describeUserRepositoryContract(
  name: string,
  setup: () => Promise<AuthPersistence>,
): void {
  describe(`IUserRepository contract — ${name}`, () => {
    let p: AuthPersistence;
    beforeEach(async () => {
      p = await setup();
    });

    it('findManyByIds: đúng các id có thật (kể cả đã xóa), bỏ id lạ; [] ⇒ []', async () => {
      const a = newUser('many-a@example.com');
      const b = newUser('many-b@example.com');
      await p.users.add(a);
      await p.users.add(b);
      await p.users.add(newUser('many-c@example.com'));
      const found = await p.users.findManyByIds([
        b.id,
        a.id,
        '0199e5a2-0000-7000-8000-00000000dead',
      ]);
      expect(found.map((u) => u.id).sort()).toEqual([a.id, b.id].sort());
      expect(await p.users.findManyByIds([])).toEqual([]);
    });

    it('add ⇒ tìm được theo id và email; email trùng ⇒ EmailAlreadyExistsError', async () => {
      const u = newUser('alice@example.com');
      await p.users.add(u);
      expect((await p.users.findById(u.id))?.email.value).toBe('alice@example.com');
      expect((await p.users.findByEmail(Email.create('alice@example.com')))?.id).toBe(u.id);
      await expect(p.users.add(newUser('alice@example.com'))).rejects.toBeInstanceOf(
        EmailAlreadyExistsError,
      );
    });

    it('getTokenVersion: user sống ⇒ tv; đã xóa / không tồn tại ⇒ null (QA B.4 P1)', async () => {
      const u = newUser();
      await p.users.add(u);
      expect(await p.users.getTokenVersion(u.id)).toBe(0);
      await p.markDeleted(u.id);
      expect(await p.users.getTokenVersion(u.id)).toBeNull();
      expect(await p.users.getTokenVersion(randomUUID())).toBeNull();
    });

    it('recordLogin: chỉ last_login_at, trả tv hiện tại; user đã xóa ⇒ null', async () => {
      const u = newUser();
      await p.users.add(u);
      await p.users.bumpTokenVersion(u.id, T0);
      expect(await p.users.recordLogin({ id: u.id, expectedHash: 'h:old', at: T1 })).toBe(1);
      expect((await p.users.findById(u.id))?.toSnapshot()).toMatchObject({
        lastLoginAt: T1,
        passwordHash: 'h:old',
        tokenVersion: 1,
      });
      await p.markDeleted(u.id);
      expect(await p.users.recordLogin({ id: u.id, expectedHash: 'h:old', at: T1 })).toBeNull();
    });

    it('recordLogin có điều kiện password_hash (G1 auth M1): hash đã đổi ⇒ null, không ghi gì', async () => {
      const u = newUser();
      await p.users.add(u);
      expect(
        await p.users.changePassword({ id: u.id, oldHash: 'h:old', newHash: 'h:new', at: T0 }),
      ).toBe(1);
      expect(await p.users.recordLogin({ id: u.id, expectedHash: 'h:old', at: T1 })).toBeNull();
      expect((await p.users.findById(u.id))?.toSnapshot().lastLoginAt).toBeNull();
      expect(await p.users.recordLogin({ id: u.id, expectedHash: 'h:new', at: T1 })).toBe(1);
    });

    it('rehashPassword có điều kiện: oldHash khớp ⇒ true + đổi; không khớp ⇒ false, không đổi', async () => {
      const u = newUser();
      await p.users.add(u);
      expect(
        await p.users.rehashPassword({ id: u.id, oldHash: 'h:stale', newHash: 'h:x', at: T1 }),
      ).toBe(false);
      expect((await p.users.findById(u.id))?.passwordHash).toBe('h:old');
      expect(
        await p.users.rehashPassword({ id: u.id, oldHash: 'h:old', newHash: 'h:re', at: T1 }),
      ).toBe(true);
      expect((await p.users.findById(u.id))?.toSnapshot()).toMatchObject({
        passwordHash: 'h:re',
        tokenVersion: 0,
        passwordChangedAt: null,
      });
    });

    it('changePassword: oldHash khớp ⇒ tv + 1 (RETURNING), hash + passwordChangedAt; sai / đã xóa ⇒ null, không đổi', async () => {
      const u = newUser();
      await p.users.add(u);
      expect(
        await p.users.changePassword({ id: u.id, oldHash: 'h:wrong', newHash: 'h:new', at: T1 }),
      ).toBeNull();
      expect(
        await p.users.changePassword({ id: u.id, oldHash: 'h:old', newHash: 'h:new', at: T1 }),
      ).toBe(1);
      expect((await p.users.findById(u.id))?.toSnapshot()).toMatchObject({
        passwordHash: 'h:new',
        passwordChangedAt: T1,
        tokenVersion: 1,
      });
      expect(
        await p.users.changePassword({ id: u.id, oldHash: 'h:old', newHash: 'h:again', at: T1 }),
      ).toBeNull();
      await p.markDeleted(u.id);
      expect(
        await p.users.changePassword({ id: u.id, oldHash: 'h:new', newHash: 'h:z', at: T1 }),
      ).toBeNull();
    });

    it('bumpTokenVersion tăng tuần tự và trả giá trị mới; user đã xóa ⇒ null', async () => {
      const u = newUser();
      await p.users.add(u);
      expect([
        await p.users.bumpTokenVersion(u.id, T1),
        await p.users.bumpTokenVersion(u.id, T1),
      ]).toEqual([1, 2]);
      await p.markDeleted(u.id);
      expect(await p.users.bumpTokenVersion(u.id, T1)).toBeNull();
    });

    it('updateProfile: chỉ full_name; user đã xóa ⇒ false', async () => {
      const u = newUser();
      await p.users.add(u);
      expect(await p.users.updateProfile({ id: u.id, fullName: 'Alice Tran', at: T1 })).toBe(true);
      expect((await p.users.findById(u.id))?.toSnapshot()).toMatchObject({
        fullName: 'Alice Tran',
        passwordHash: 'h:old',
        tokenVersion: 0,
      });
      await p.markDeleted(u.id);
      expect(await p.users.updateProfile({ id: u.id, fullName: 'X', at: T1 })).toBe(false);
    });
  });
}
