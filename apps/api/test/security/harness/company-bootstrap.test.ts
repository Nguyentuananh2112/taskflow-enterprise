import { describe, expect, it } from 'vitest';

import { bootstrapEnv, parseBootstrapOutput, shiftIso, tokenOfLink } from './company-bootstrap';

describe('harness company-bootstrap', () => {
  it('tokenOfLink lấy token từ fragment #t=', () => {
    expect(tokenOfLink('http://localhost:3000/activate#t=abc_DEF-123')).toBe('abc_DEF-123');
  });

  it('tokenOfLink ném lỗi khi thiếu fragment (token ở query là sai thiết kế)', () => {
    expect(() => tokenOfLink('http://localhost:3000/activate?t=abc')).toThrow(/fragment/);
    expect(() => tokenOfLink('http://localhost:3000/activate#x=abc')).toThrow(/fragment/);
  });

  it('parseBootstrapOutput lấy dòng JSON cuối có {link, userId}, bỏ qua log khác', () => {
    const stdout = [
      '{"level":30,"msg":"connecting"}',
      'not json',
      '{"link":"http://w.test/activate#t=tok1","userId":"u-1"}',
      '{"level":30,"msg":"done"}',
      '',
    ].join('\n');
    expect(parseBootstrapOutput(stdout)).toEqual({
      link: 'http://w.test/activate#t=tok1',
      userId: 'u-1',
      token: 'tok1',
    });
  });

  it('parseBootstrapOutput ném lỗi kèm output khi không có kết quả', () => {
    expect(() => parseBootstrapOutput('{"level":50,"msg":"Đã có Admin"}\n{broken')).toThrow(
      /Đã có Admin/,
    );
  });

  it('bootstrapEnv thêm biến CLI, giữ env của suite', () => {
    expect(bootstrapEnv({ DATABASE_URL: 'pg://x', APP_ENV: 'test' }, { email: 'a@x' })).toEqual({
      DATABASE_URL: 'pg://x',
      APP_ENV: 'test',
      BOOTSTRAP_ADMIN_EMAIL: 'a@x',
      BOOTSTRAP_ADMIN_NAME: 'Sec Ada',
      COMPANY_NAME: 'Sec Company',
    });
  });

  it('shiftIso dời mốc theo ms', () => {
    expect(shiftIso('2026-10-20T03:00:00.000Z', 7 * 86_400_000 - 30_000)).toBe(
      '2026-10-27T02:59:30.000Z',
    );
  });
});
