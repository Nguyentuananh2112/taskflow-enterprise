import { describe, expect, it } from 'vitest';

import { safeNextPath } from './safe-next-path';

describe('safeNextPath (chống open redirect)', () => {
  it.each([
    ['/w', '/w'],
    ['/w/0199e5a2/p/0199e5a3?task=1', '/w/0199e5a2/p/0199e5a3?task=1'],
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

  // T-029 H1: chuỗi thô "trông" hợp lệ nhưng parser chuẩn hóa thành `//evil.com` (host khác).
  it.each([
    '/..//evil.com',
    '/.//evil.com',
    '/a/..//evil.com',
    '/w/../..//evil.com',
    '/%2e//evil.com',
    '/%2E%2E//evil.com',
    '/%2e%2e/%2e%2e//evil.com',
    '/w/%2e%2e//evil.com',
    '/./\\evil.com',
    '/w\\..\\..\\evil.com',
    '/%2f%2fevil.com',
    '/%5c%5cevil.com',
    '/%2F/evil.com',
  ])('dot-segment / mã hóa / backslash: %j ⇒ /w', (raw) => {
    expect(safeNextPath(raw)).toBe('/w');
  });

  it.each(['/login', '/register', '/mock-api/v1/auth/logout', '/api/healthz', '/'])(
    'ngoài whitelist (%j) ⇒ /w',
    (raw) => {
      expect(safeNextPath(raw)).toBe('/w');
    },
  );

  it('kết quả không bao giờ trỏ sang host khác (kiểm bằng chính URL parser)', () => {
    const samples = ['/..//evil.com', '/%2e//evil.com', '/w/../account', '/w?next=//evil.com'];
    for (const raw of samples) {
      expect(new URL(safeNextPath(raw), 'https://app.example.com').host).toBe('app.example.com');
    }
  });

  it('fallback tùy chọn', () => {
    expect(safeNextPath('//x', '/account')).toBe('/account');
  });
});
