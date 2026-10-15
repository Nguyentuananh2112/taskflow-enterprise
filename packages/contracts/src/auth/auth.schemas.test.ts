import { describe, expect, it } from 'vitest';

import {
  ChangePasswordBody,
  Email,
  FullName,
  LoginBody,
  MeResponse,
  Password,
  RegisterBody,
  UpdateMeBody,
} from '../index';

const ID = '0199e5a2-7c1e-7cc3-9a3b-1f2e3d4c5b6a';

describe('Email', () => {
  it('trim + lowercase trước khi validate', () => {
    expect(Email.parse('  Mia@Example.COM ')).toBe('mia@example.com');
  });
  it('biên 254 ký tự sau trim', () => {
    const local = 'a'.repeat(64);
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.vn`; // 189 ký tự
    expect(`${local}@${domain}`).toHaveLength(254);
    expect(Email.safeParse(`  ${local}@${domain}  `).success).toBe(true);
    expect(Email.safeParse(`${local}@x${domain}`).success).toBe(false);
  });
  it('từ chối định dạng sai và quá 254 ký tự', () => {
    expect(Email.safeParse('mia@').success).toBe(false);
    expect(Email.safeParse(`${'a'.repeat(250)}@x.vn`).success).toBe(false);
  });
});

describe('Password (ADR-049, ADR-065)', () => {
  it('biên 12 và 256 code point', () => {
    expect(Password.safeParse('a'.repeat(11)).success).toBe(false);
    expect(Password.safeParse('a'.repeat(12)).success).toBe(true);
    expect(Password.safeParse('a'.repeat(256)).success).toBe(true);
    expect(Password.safeParse('a'.repeat(257)).success).toBe(false);
  });
  it('đếm theo code point, không theo UTF-16 code unit', () => {
    // 12 emoji = 12 code point nhưng 24 code unit.
    expect(Password.safeParse('😀'.repeat(12)).success).toBe(true);
    expect(Password.safeParse('😀'.repeat(256)).success).toBe(true);
  });
  it('chuẩn hóa NFC: dạng tổ hợp và dựng sẵn cho cùng kết quả', () => {
    const nfd = 'mậtkhẩuđủdài'.normalize('NFD');
    const nfc = 'mậtkhẩuđủdài'.normalize('NFC');
    expect(Password.parse(nfd)).toBe(nfc);
  });
});

describe('FullName', () => {
  it('trim, 1–100, cấm ký tự điều khiển', () => {
    expect(FullName.parse('  Nguyễn Văn An ')).toBe('Nguyễn Văn An');
    expect(FullName.safeParse('   ').success).toBe(false);
    expect(FullName.safeParse('x'.repeat(101)).success).toBe(false);
    expect(FullName.safeParse('An\u0000').success).toBe(false);
  });
});

describe('body auth', () => {
  it('RegisterBody đủ trường, từ chối field lạ', () => {
    const ok = { email: 'a@b.vn', password: 'đủ-mười-hai-ký', fullName: 'An' };
    expect(RegisterBody.safeParse(ok).success).toBe(true);
    expect(RegisterBody.safeParse({ ...ok, role: 'OWNER' }).success).toBe(false);
  });
  it('LoginBody không áp chính sách độ dài tối thiểu nhưng chặn rỗng/quá dài', () => {
    expect(LoginBody.safeParse({ email: 'a@b.vn', password: 'short' }).success).toBe(true);
    expect(LoginBody.safeParse({ email: 'a@b.vn', password: '' }).success).toBe(false);
    expect(LoginBody.safeParse({ email: 'a@b.vn', password: 'a'.repeat(257) }).success).toBe(false);
  });
  it('ChangePasswordBody áp chính sách cho mật khẩu mới', () => {
    expect(
      ChangePasswordBody.safeParse({ currentPassword: 'cũ', newPassword: 'ngắn' }).success,
    ).toBe(false);
    expect(
      ChangePasswordBody.safeParse({ currentPassword: 'cũ', newPassword: 'mới-đủ-dài-12' }).success,
    ).toBe(true);
  });
  it('UpdateMeBody strict, chỉ fullName (ADR-083)', () => {
    expect(UpdateMeBody.safeParse({ fullName: 'An' }).success).toBe(true);
    expect(UpdateMeBody.safeParse({ fullName: 'An', email: 'x@y.vn' }).success).toBe(false);
  });
});

describe('MeResponse', () => {
  it('có user và memberships với role hợp lệ', () => {
    const user = { id: ID, email: 'a@b.vn', fullName: 'An', createdAt: '2026-10-15T08:00:00Z' };
    const m = { workspaceId: ID, workspaceName: 'W', slug: 'w-1', role: 'PM' };
    expect(MeResponse.safeParse({ user, memberships: [m] }).success).toBe(true);
    expect(MeResponse.safeParse({ user, memberships: [{ ...m, role: 'ADMIN' }] }).success).toBe(
      false,
    );
  });
});
