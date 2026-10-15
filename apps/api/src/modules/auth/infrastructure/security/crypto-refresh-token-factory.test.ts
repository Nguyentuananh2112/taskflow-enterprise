import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CryptoRefreshTokenFactory } from './crypto-refresh-token-factory';

const factory = new CryptoRefreshTokenFactory();

describe('CryptoRefreshTokenFactory (security.md 2.2)', () => {
  it('token = 32 byte ngẫu nhiên dạng base64url (43 ký tự, không padding)', () => {
    const { token } = factory.generate();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('hash = SHA-256 hex của token (64 ký tự)', () => {
    const { token, hash } = factory.generate();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(factory.hash(token)).toBe(hash);
  });

  it('mỗi lần generate cho token khác nhau', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => factory.generate().token));
    expect(tokens.size).toBe(1000);
  });

  it('matches: đúng token ⇒ true, token khác ⇒ false', () => {
    const { token, hash } = factory.generate();
    expect(factory.matches(token, hash)).toBe(true);
    expect(factory.matches(factory.generate().token, hash)).toBe(false);
  });

  it.each([
    ['hash sai độ dài', 'abc'],
    ['hash không phải hex', 'z'.repeat(64)],
    ['hash rỗng', ''],
  ])('matches với %s ⇒ false, không ném lỗi', (_label, badHash) => {
    expect(factory.matches(factory.generate().token, badHash)).toBe(false);
  });

  it('QA B.4: regex hash có neo ^…$ — tiền tố/hậu tố lạ quanh hash hợp lệ ⇒ false', () => {
    const { token, hash } = factory.generate();
    expect(factory.matches(token, `x${hash}`)).toBe(false);
    expect(factory.matches(token, `${hash}x`)).toBe(false);
  });
});
