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

  const result = {
    userId: 'u-1',
    link: 'http://w.test/activate#t=tok1',
    token: 'tok1',
    expiresAt: '2026-10-21T03:00:00.000Z',
  };

  it('parseBootstrapOutput đọc dòng JSON duy nhất ở cuối stdout', () => {
    expect(parseBootstrapOutput(`Đang tạo Admin…\n${JSON.stringify(result)}\n`)).toEqual(result);
  });

  it('parseBootstrapOutput ném lỗi kèm output khi stdout sai hợp đồng', () => {
    const line = JSON.stringify(result);
    // Hai dòng JSON (log lọt vào stdout).
    expect(() => parseBootstrapOutput(`{"level":30}\n${line}`)).toThrow(/đúng một dòng JSON/);
    // JSON không ở dòng cuối.
    expect(() => parseBootstrapOutput(`${line}\nxong`)).toThrow(/dòng cuối/);
    // Thiếu trường.
    expect(() => parseBootstrapOutput('{"userId":"u-1","link":"http://w.test/a#t=x"}')).toThrow(
      /thiếu/,
    );
    // token không khớp fragment.
    expect(() => parseBootstrapOutput(JSON.stringify({ ...result, token: 'other' }))).toThrow(
      /không khớp/,
    );
    // Không có gì (vd "Đã có Admin" ra stderr, exit 1).
    expect(() => parseBootstrapOutput('')).toThrow(/đúng một dòng JSON/);
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
