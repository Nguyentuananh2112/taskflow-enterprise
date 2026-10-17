import { describe, expect, it } from 'vitest';

import { avatarFileKey, isFileKey, randomFileKey, relativePathOf, type FileKey } from './file-key';
import {
  bucketExpiry,
  canonicalTuple,
  isVariantOf,
  purposeOf,
  signMedia,
  verifyMedia,
  type MediaTuple,
} from './media-signature';

const SECRET = 'test-only-file-url-secret-0123456789abcdef';
const OLD = 'test-only-file-url-secret-previous-0123456789';
const USER = '0b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a';

const tuple = (over: Partial<MediaTuple> = {}): MediaTuple => ({
  kind: 'avatars',
  id: USER,
  variant: '64',
  version: 3,
  exp: 2_000,
  ...over,
});

describe('verifyMedia — tuple chuẩn hóa (CH-09, SEC-CH-11/35)', () => {
  it('tuple v1 đúng thứ tự', () => {
    expect(canonicalTuple(tuple())).toBe(`v1|view|avatars|${USER}|64|3|2000`);
    expect(canonicalTuple(tuple({ kind: 'chat', variant: 'file', version: 1 }))).toBe(
      `v1|download|chat|${USER}|file|1|2000`,
    );
  });

  it('chữ ký đúng ⇒ hợp lệ; 43 ký tự base64url', () => {
    const sig = signMedia(SECRET, tuple());
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyMedia({ current: SECRET }, tuple(), sig, 1_999)).toBe(true);
  });

  it('biên hết hạn: now = exp − 1 còn, now = exp hết', () => {
    const sig = signMedia(SECRET, tuple());
    expect(verifyMedia({ current: SECRET }, tuple(), sig, 1_999)).toBe(true);
    expect(verifyMedia({ current: SECRET }, tuple(), sig, 2_000)).toBe(false);
  });

  it.each([
    ['kind', { kind: 'chat' as const, variant: 'preview' as const }],
    ['id', { id: '1b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a' }],
    ['variant', { variant: '256' as const }],
    ['version', { version: 4 }],
    ['exp', { exp: 2_001 }],
  ])('đổi %s giữ sig ⇒ sai', (_n, over) => {
    const sig = signMedia(SECRET, tuple());
    expect(verifyMedia({ current: SECRET }, tuple(over), sig, 1_000)).toBe(false);
  });

  it('đổi purpose (preview ⇒ file cùng id) ⇒ sai', () => {
    const t = tuple({ kind: 'chat', variant: 'preview', version: 1 });
    const sig = signMedia(SECRET, t);
    expect(verifyMedia({ current: SECRET }, { ...t, variant: 'file' }, sig, 1_000)).toBe(false);
  });

  it('xoay khóa: ký bằng khóa cũ vẫn kiểm được khi có _PREVIOUS; không có ⇒ sai', () => {
    const sig = signMedia(OLD, tuple());
    expect(verifyMedia({ current: SECRET, previous: OLD }, tuple(), sig, 1_000)).toBe(true);
    expect(verifyMedia({ current: SECRET }, tuple(), sig, 1_000)).toBe(false);
  });

  it('khóa lạ ⇒ sai', () => {
    const sig = signMedia('test-only-some-other-secret-0123456789abc', tuple());
    expect(verifyMedia({ current: SECRET, previous: OLD }, tuple(), sig, 1_000)).toBe(false);
  });

  it.each([
    ['rỗng', ''],
    ['42 ký tự', 'a'.repeat(42)],
    ['44 ký tự', 'a'.repeat(44)],
    ['ký tự ngoài base64url', `${'a'.repeat(42)}+`],
    ['padding', `${'a'.repeat(42)}=`],
  ])('định dạng sig sai (%s) ⇒ sai, không ném', (_n, sig) => {
    expect(verifyMedia({ current: SECRET }, tuple(), sig, 1_000)).toBe(false);
  });

  it('purposeOf / isVariantOf', () => {
    expect(purposeOf('file')).toBe('download');
    expect(purposeOf('thumb')).toBe('view');
    expect(isVariantOf('avatars', '64')).toBe(true);
    expect(isVariantOf('avatars', 'file')).toBe(false);
    expect(isVariantOf('chat', 'file')).toBe(true);
    expect(isVariantOf('chat', '256')).toBe(false);
  });
});

describe('bucketExpiry — khung URL (AV-03)', () => {
  const DAY = 86_400;
  it('ổn định trong cùng khung, đổi đúng ở biên', () => {
    const start = 100 * DAY;
    expect(bucketExpiry(start, DAY)).toBe(102 * DAY);
    expect(bucketExpiry(start + DAY - 1, DAY)).toBe(102 * DAY);
    expect(bucketExpiry(start + DAY, DAY)).toBe(103 * DAY);
    expect(bucketExpiry(start - 1, DAY)).toBe(101 * DAY);
  });

  it('URL sống trong [bucket, 2 × bucket)', () => {
    for (const now of [0, 1, 3_599, 3_600, 7_199, 123_456]) {
      const left = bucketExpiry(now, 3_600) - now;
      expect(left).toBeGreaterThan(3_600 - 1);
      expect(left).toBeLessThanOrEqual(7_200);
    }
  });
});

describe('file-key — khóa do server sinh', () => {
  it('16 byte ⇒ 26 ký tự base32 chữ thường', () => {
    const zero = randomFileKey(new Uint8Array(16));
    expect(zero).toBe('a'.repeat(26));
    const ff = randomFileKey(new Uint8Array(16).fill(0xff));
    expect(ff).toBe(`${'7'.repeat(25)}4`); // 3 bit cuối 111 đệm 0 ⇒ 11100 = '4'
    expect(isFileKey(ff)).toBe(true);
  });

  it('RFC 4648: "foobar" ⇒ mzxw6ytboi (kiểm bộ mã hóa)', () => {
    const b = new Uint8Array(16);
    b.set(Buffer.from('foobar'));
    expect(randomFileKey(b).startsWith('mzxw6ytboi')).toBe(true);
  });

  it('độ dài khác 16 ⇒ ném', () => {
    expect(() => randomFileKey(new Uint8Array(15))).toThrow(RangeError);
  });

  it.each([
    '../../etc/passwd',
    'AAAAAAAAAAAAAAAAAAAAAAAAAA',
    'a'.repeat(25),
    'a'.repeat(27),
    `${'a'.repeat(25)}1`,
    `avatars/${USER}/0/64`,
    `avatars/${USER}/1/128`,
    `avatars/${USER}/1/64/../../x`,
    `avatars/not-a-uuid/1/64`,
    `tmp/${'a'.repeat(26)}`,
  ])('khóa sai %j bị từ chối', (key) => {
    expect(isFileKey(key)).toBe(false);
  });

  it('khóa avatar', () => {
    const key = avatarFileKey(USER.toUpperCase(), 7, '256');
    expect(key).toBe(`avatars/${USER}/7/256`);
    expect(relativePathOf(key)).toBe(key);
    expect(() => avatarFileKey(USER, 0, '64')).toThrow(RangeError);
    expect(() => avatarFileKey('x', 1, '64')).toThrow(RangeError);
  });

  it('đường dẫn khóa ngẫu nhiên ab/cd/<key>', () => {
    const key = 'abcdefghijklmnopqrstuvwxyz' as FileKey;
    expect(relativePathOf(key)).toBe('ab/cd/abcdefghijklmnopqrstuvwxyz');
  });
});
