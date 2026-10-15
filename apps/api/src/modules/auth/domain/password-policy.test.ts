import { afterEach, describe, expect, it, vi } from 'vitest';

import { Email } from './email';
import { PasswordPolicy } from './password-policy';

const policy = new PasswordPolicy(new Set(['qwertyuiop123', 'correcthorsebattery']));
const alice = Email.create('alice@example.com');

describe('PasswordPolicy (ADR-049, ADR-065)', () => {
  it('chấp nhận mật khẩu hợp lệ 12 ký tự', () => {
    expect(policy.check('zt7-kLm9-pQ2')).toEqual({ ok: true });
  });

  it('từ chối 11 ký tự (TOO_SHORT)', () => {
    expect(policy.check('zt7-kLm9-pQ')).toEqual({ ok: false, violations: ['TOO_SHORT'] });
  });

  it('chấp nhận đúng 256 ký tự, từ chối 257 (TOO_LONG)', () => {
    expect(policy.check('x7'.repeat(128))).toEqual({ ok: true });
    expect(policy.check(`${'x7'.repeat(128)}y`)).toEqual({ ok: false, violations: ['TOO_LONG'] });
  });

  it('đếm theo code point sau NFC, không theo UTF-16 code unit hay byte', () => {
    // 12 emoji = 24 code unit UTF-16, 48 byte UTF-8 — vẫn là 12 ký tự.
    expect(policy.check('😀'.repeat(12))).toEqual({ ok: true });
    expect(policy.check('😀'.repeat(11))).toEqual({ ok: false, violations: ['TOO_SHORT'] });
  });

  it('chữ có dấu dạng NFD (2 code point) được đếm là 1 ký tự sau NFC', () => {
    const eNfd = 'é'; // é dạng tổ hợp
    expect(policy.check(eNfd.repeat(12))).toEqual({ ok: true });
    expect(policy.check(eNfd.repeat(11))).toEqual({ ok: false, violations: ['TOO_SHORT'] });
  });

  it('chấp nhận 100 ký tự tiếng Việt có dấu (không còn giới hạn 72 byte)', () => {
    const vi = 'Mật khẩu dài của tôi '.repeat(5).slice(0, 100);
    expect(new TextEncoder().encode(vi).length).toBeGreaterThan(72);
    expect(policy.check(vi)).toEqual({ ok: true });
  });

  it('từ chối mật khẩu trong danh sách phổ biến, không phân biệt hoa thường (COMMON)', () => {
    expect(policy.check('QwertyUIOP123')).toEqual({ ok: false, violations: ['COMMON'] });
  });

  it('từ chối mật khẩu chứa phần local của email, không phân biệt hoa thường (CONTAINS_EMAIL)', () => {
    expect(policy.check('my-ALICE-secret-1', alice)).toEqual({
      ok: false,
      violations: ['CONTAINS_EMAIL'],
    });
  });

  it('bỏ qua kiểm tra email khi phần local quá ngắn (< 3) để không chặn oan', () => {
    expect(policy.check('a-perfectly-fine-pw', Email.create('a@example.com'))).toEqual({
      ok: true,
    });
  });

  it('không kiểm tra email khi không truyền email', () => {
    expect(policy.check('my-alice-secret-1')).toEqual({ ok: true });
  });

  it('trả đủ mọi vi phạm cùng lúc, thứ tự cố định', () => {
    const shortPolicy = new PasswordPolicy(new Set(['alice']));
    expect(shortPolicy.check('alice', alice)).toEqual({
      ok: false,
      violations: ['TOO_SHORT', 'COMMON', 'CONTAINS_EMAIL'],
    });
  });

  it('không cắt khoảng trắng (khoảng trắng là một phần của mật khẩu)', () => {
    expect(policy.check(' zt7-kLm9-pQ')).toEqual({ ok: true });
  });

  describe('chặn chuỗi khổng lồ trước khi chuẩn hóa NFC (phòng thủ chiều sâu, review T-013)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('> 1024 UTF-16 unit ⇒ TOO_LONG mà không gọi normalize', () => {
      const spy = vi.spyOn(String.prototype, 'normalize');
      expect(policy.check('x'.repeat(10_000))).toEqual({ ok: false, violations: ['TOO_LONG'] });
      expect(PasswordPolicy.exceedsMaxLength('x'.repeat(1025))).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it('256 chữ tiếng Việt dạng NFD (768 unit) vẫn hợp lệ — ngưỡng rẻ không chặn oan', () => {
      const nfd = 'ệ'.normalize('NFD').repeat(256); // ệ = e + 2 dấu tổ hợp
      expect(nfd.length).toBe(768);
      expect(PasswordPolicy.exceedsMaxLength(nfd)).toBe(false);
      expect(policy.check(nfd)).toEqual({ ok: true });
    });

    it('257 ký tự sau NFC ⇒ exceedsMaxLength true (ngưỡng chính xác vẫn áp dụng)', () => {
      expect(PasswordPolicy.exceedsMaxLength('y'.repeat(257))).toBe(true);
      expect(PasswordPolicy.exceedsMaxLength('y'.repeat(256))).toBe(false);
    });
  });

  it('normalize() trả dạng NFC — dùng chung với hasher', () => {
    expect(PasswordPolicy.normalize('é')).toBe('é');
  });
});
