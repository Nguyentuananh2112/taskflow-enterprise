import { describe, expect, it } from 'vitest';

import { safeNextPath } from './safe-next-path';

describe('safeNextPath (chống open redirect)', () => {
  it.each([
    ['/w', '/w'],
    ['/account?tab=password#doi-mat-khau', '/account?tab=password#doi-mat-khau'],
    ['/w/../account', '/account'],
  ])('giữ đường dẫn nội bộ %j', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'w',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com/w',
    'javascript:alert(1)',
    '/\u0000//evil.com',
    '/\n/evil.com',
    '\t/w',
  ])('từ chối %j ⇒ /w', (raw) => {
    expect(safeNextPath(raw)).toBe('/w');
  });

  it('fallback tùy chọn', () => {
    expect(safeNextPath('//x', '/account')).toBe('/account');
  });
});
