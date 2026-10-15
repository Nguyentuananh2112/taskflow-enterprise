import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../core/errors';
import { Email } from './email';
import { User } from './user';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const LATER = new Date('2026-11-02T00:00:00.000Z');

const register = (fullName = 'Alice Nguyen') =>
  User.register({
    id: 'u1',
    email: Email.create('alice@example.com'),
    passwordHash: 'h:pw',
    fullName,
    now: NOW,
  });

describe('User', () => {
  it('register: tokenVersion 0, chưa đăng nhập, chưa xóa, phát UserRegistered', () => {
    const user = register();
    expect(user.toSnapshot()).toEqual({
      id: 'u1',
      email: 'alice@example.com',
      passwordHash: 'h:pw',
      fullName: 'Alice Nguyen',
      tokenVersion: 0,
      passwordChangedAt: null,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(user.pullDomainEvents()).toEqual([
      { type: 'UserRegistered', aggregateId: 'u1', occurredAt: NOW },
    ]);
  });

  it('fullName được trim (REG-08)', () => {
    expect(register('  Alice ').fullName).toBe('Alice');
  });

  it.each([
    ['rỗng sau trim', '   ', 'too_small'],
    ['101 ký tự', 'a'.repeat(101), 'too_big'],
    ['ký tự điều khiển', 'Alice\u0007', 'invalid_format'],
    ['xuống dòng', 'Alice\nBob', 'invalid_format'],
  ])('fullName %s ⇒ ValidationError (REG-08, ME-02)', (_label, name, code) => {
    try {
      register(name);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues).toEqual([
        { path: ['fullName'], code, message: expect.any(String) as string },
      ]);
    }
  });

  it('fullName 100 ký tự có dấu (đếm code point) hợp lệ', () => {
    expect(register('ệ'.repeat(100)).fullName).toHaveLength(100);
  });

  it('recordLogin cập nhật lastLoginAt, không đổi tokenVersion', () => {
    const user = register();
    user.recordLogin(LATER);
    expect(user.lastLoginAt).toEqual(LATER);
    expect(user.tokenVersion).toBe(0);
  });

  it('replacePasswordHash (rehash) không tăng tokenVersion, không phát event', () => {
    const user = register();
    user.pullDomainEvents();
    user.replacePasswordHash('h:new', LATER);
    expect(user.passwordHash).toBe('h:new');
    expect(user.tokenVersion).toBe(0);
    expect(user.passwordChangedAt).toBeNull();
    expect(user.pullDomainEvents()).toEqual([]);
  });

  it('changePassword: hash mới, passwordChangedAt, tokenVersion + 1, phát UserPasswordChanged', () => {
    const user = register();
    user.pullDomainEvents();
    user.changePassword('h:new', LATER);
    expect(user.passwordHash).toBe('h:new');
    expect(user.passwordChangedAt).toEqual(LATER);
    expect(user.tokenVersion).toBe(1);
    expect(user.pullDomainEvents()).toEqual([
      { type: 'UserPasswordChanged', aggregateId: 'u1', occurredAt: LATER },
    ]);
  });

  it('revokeAllSessions: tokenVersion + 1, phát UserSessionsRevoked', () => {
    const user = register();
    user.pullDomainEvents();
    user.revokeAllSessions(LATER);
    user.revokeAllSessions(LATER);
    expect(user.tokenVersion).toBe(2);
    expect(user.pullDomainEvents().map((e) => e.type)).toEqual([
      'UserSessionsRevoked',
      'UserSessionsRevoked',
    ]);
  });

  it('rename: trim + validate, cập nhật updatedAt, không đổi gì khác (ME-01)', () => {
    const user = register();
    user.rename('  Alice Tran ', LATER);
    expect(user.fullName).toBe('Alice Tran');
    expect(user.updatedAt).toEqual(LATER);
    expect(user.tokenVersion).toBe(0);
    expect(() => user.rename('', LATER)).toThrow(ValidationError);
  });

  it('reconstitute giữ nguyên trạng thái, không phát event; isDeleted theo deletedAt', () => {
    const snap = { ...register().toSnapshot(), tokenVersion: 3, deletedAt: LATER };
    const user = User.reconstitute(snap);
    expect(user.toSnapshot()).toEqual(snap);
    expect(user.isDeleted).toBe(true);
    expect(user.pullDomainEvents()).toEqual([]);
  });
});
