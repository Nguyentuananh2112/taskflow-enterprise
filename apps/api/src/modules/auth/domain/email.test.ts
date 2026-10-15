import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../core/errors';
import { Email } from './email';

describe('Email', () => {
  it('chuẩn hóa trim + lowercase', () => {
    expect(Email.create('  Alice@Example.COM ').value).toBe('alice@example.com');
  });

  it('chuẩn hóa NFC (cùng một địa chỉ ở dạng NFD và NFC là bằng nhau)', () => {
    const nfd = 'josé@example.com';
    const nfc = 'josé@example.com';
    expect(Email.create(nfd).equals(Email.create(nfc))).toBe(true);
    expect(Email.create(nfd).value).toBe(nfc);
  });

  it('localPart trả phần trước @', () => {
    expect(Email.create('Alice.N@example.com').localPart).toBe('alice.n');
  });

  it.each([
    ['', 'rỗng'],
    ['   ', 'chỉ khoảng trắng'],
    ['alice', 'không có @'],
    ['@example.com', 'thiếu phần local'],
    ['alice@', 'thiếu domain'],
    ['alice@example', 'domain không có dấu chấm'],
    ['alice@@example.com', 'hai dấu @'],
    ['ali ce@example.com', 'khoảng trắng ở giữa'],
    ['alice@exa mple.com', 'khoảng trắng trong domain'],
    ['alice@example.com.', 'domain kết thúc bằng dấu chấm'],
    ['alice@.example.com', 'domain bắt đầu bằng dấu chấm'],
  ])('từ chối %j (%s)', (raw) => {
    expect(() => Email.create(raw)).toThrow(ValidationError);
  });

  it('từ chối phần local dài hơn 64 ký tự', () => {
    expect(() => Email.create(`${'a'.repeat(65)}@example.com`)).toThrow(ValidationError);
    expect(Email.create(`${'a'.repeat(64)}@example.com`).localPart).toHaveLength(64);
  });

  it('từ chối email dài hơn 254 ký tự (khớp VarChar(254))', () => {
    const domain = `${'d'.repeat(63)}.${'e'.repeat(63)}.${'f'.repeat(57)}.com`; // 189 ký tự
    const ok = `${'a'.repeat(64)}@${domain}`;
    expect(ok).toHaveLength(254);
    expect(Email.create(ok).value).toHaveLength(254);
    expect(() => Email.create(`${ok}x`)).toThrow(ValidationError);
  });

  it('lỗi là ValidationError (path email) và không chứa giá trị email (không lộ PII vào log)', () => {
    try {
      Email.create('secret-person');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe('VALIDATION_ERROR');
      expect((err as ValidationError).issues).toEqual([
        { path: ['email'], code: 'invalid_format', message: 'Email không hợp lệ.' },
      ]);
      expect((err as Error).message).not.toContain('secret-person');
    }
  });
});
