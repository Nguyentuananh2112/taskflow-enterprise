import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../core/errors';
import { isValidSlugFormat, normalizeName, slugifyName } from './names';

const issue = (fn: () => unknown) => {
  try {
    fn();
    return expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).issues.map((i) => `${i.path.join('.')}:${i.code}`);
  }
};

describe('normalizeName (R19 — tên workspace/project)', () => {
  it('trim, giữ nguyên chữ có dấu', () => {
    expect(normalizeName('  Đội Phát Triển ', 'name')).toBe('Đội Phát Triển');
  });

  it('rỗng / 101 ký tự / ký tự điều khiển ⇒ 400 (WSC-04)', () => {
    expect(issue(() => normalizeName('  ', 'name'))).toEqual(['name:too_small']);
    expect(issue(() => normalizeName('a'.repeat(101), 'name'))).toEqual(['name:too_big']);
    expect(issue(() => normalizeName('A\u0007B', 'name'))).toEqual(['name:invalid_format']);
    expect(normalizeName('ệ'.repeat(100), 'name')).toHaveLength(100);
  });
});

describe('isValidSlugFormat (R19)', () => {
  it.each(['Has Space', '-abc', 'abc-', 'a--b', 'ab', 'a'.repeat(51), 'Marketing', 'abc_d', 'đội'])(
    '%j không hợp lệ (WSC-04)',
    (slug) => expect(isValidSlugFormat(slug)).toBe(false),
  );

  it.each(['abc', 'a'.repeat(50), 'marketing', 'team-2026', 'a1-b2-c3'])(
    '%j hợp lệ (WSC-04b)',
    (slug) => expect(isValidSlugFormat(slug)).toBe(true),
  );
});

describe('slugifyName (R19 — phần gốc, chưa có hậu tố)', () => {
  it.each([
    ['Đội Phát Triển Sản Phẩm', 'doi-phat-trien-san-pham'],
    ['Nguyễn Văn Đức', 'nguyen-van-duc'],
    ['  Marketing & Sales!! ', 'marketing-sales'],
    ['ĐẶNG THỊ Ỷ', 'dang-thi-y'],
    ['a__b  c', 'a-b-c'],
    ['李', ''],
    ['!!!', ''],
  ])('%j ⇒ %j', (name, slug) => expect(slugifyName(name)).toBe(slug));

  it('cắt ≤ 40 ký tự và không kết thúc bằng "-" (WSC-02)', () => {
    const slug = slugifyName(`${'abc '.repeat(9)}defgh ijk`); // phần thứ 10 vắt qua mốc 40
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(isValidSlugFormat(slug)).toBe(true);
  });
});
