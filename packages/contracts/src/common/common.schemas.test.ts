import * as z from 'zod';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ApiError,
  Cursor,
  ErrorCode,
  ValidationErrorDetails,
  apiSuccess,
  applyVietnameseZodLocale,
  limitQuery,
  multiLineTextOrNull,
  searchQuery,
  singleLineText,
  toValidationIssues,
} from '../index';

const META = { timestamp: '2026-10-15T08:00:00.000Z', requestId: 'req-1' };

describe('primitives', () => {
  it('singleLineText trim, kiểm biên và cấm ký tự điều khiển', () => {
    const s = singleLineText(3, 5);
    expect(s.parse('  abc  ')).toBe('abc');
    expect(s.safeParse('ab').success).toBe(false);
    expect(s.safeParse('abcdef').success).toBe(false);
    expect(s.safeParse('a\nbc').success).toBe(false);
    expect(s.safeParse('a\u0007bc').success).toBe(false);
  });

  it('multiLineTextOrNull cho phép xuống dòng, rỗng ⇒ null', () => {
    const s = multiLineTextOrNull(10);
    expect(s.parse('a\nb\tc')).toBe('a\nb\tc');
    expect(s.parse('   ')).toBeNull();
    expect(s.parse(null)).toBeNull();
    expect(s.safeParse('a\u0000b').success).toBe(false);
    expect(s.safeParse('x'.repeat(11)).success).toBe(false);
  });

  it('limitQuery ép kiểu từ query string, có mặc định và biên', () => {
    const l = limitQuery(100, 50);
    expect(l.parse(undefined)).toBe(50);
    expect(l.parse('100')).toBe(100);
    expect(l.safeParse('0').success).toBe(false);
    expect(l.safeParse('101').success).toBe(false);
    expect(l.safeParse('1.5').success).toBe(false);
  });

  it('searchQuery: rỗng sau trim ⇒ không lọc, quá dài ⇒ lỗi', () => {
    const q = searchQuery(100);
    expect(q.parse('  An  ')).toBe('An');
    expect(q.parse('   ')).toBeUndefined();
    expect(q.parse(undefined)).toBeUndefined();
    expect(q.safeParse('x'.repeat(101)).success).toBe(false);
  });

  it('Cursor chỉ nhận base64url', () => {
    expect(Cursor.safeParse('eyJpZCI6MX0').success).toBe(true);
    expect(Cursor.safeParse('abc=').success).toBe(false);
    expect(Cursor.safeParse('').success).toBe(false);
  });
});

describe('envelope', () => {
  it('apiSuccess bọc data và meta.page tùy chọn', () => {
    const S = apiSuccess(z.object({ id: z.string() }));
    expect(S.safeParse({ success: true, data: { id: 'x' }, meta: META }).success).toBe(true);
    const page = { nextCursor: null, hasMore: false, limit: 50 };
    expect(S.safeParse({ success: true, data: { id: 'x' }, meta: { ...META, page } }).success).toBe(
      true,
    );
    expect(S.safeParse({ success: false, data: { id: 'x' }, meta: META }).success).toBe(false);
  });

  it('ApiError chỉ nhận code trong danh mục', () => {
    const body = { code: 'VERSION_CONFLICT', message: 'x', details: null };
    expect(ApiError.safeParse({ success: false, error: body, meta: META }).success).toBe(true);
    expect(
      ApiError.safeParse({ success: false, error: { ...body, code: 'TEAPOT' }, meta: META })
        .success,
    ).toBe(false);
    expect(ErrorCode.options).toHaveLength(21);
  });
});

describe('locale & validation issues (ADR-081, ADR-096)', () => {
  afterAll(() => z.config(z.locales.en()));

  it('thông điệp tiếng Việt, giữ code + path, không có input', () => {
    applyVietnameseZodLocale();
    const r = z.strictObject({ password: z.string().min(12) }).safeParse({
      password: 'bí-mật',
      x: 1,
    });
    expect(r.success).toBe(false);
    const issues = toValidationIssues(r.error!);
    expect(issues).toContainEqual(
      expect.objectContaining({ path: ['password'], code: 'too_small' }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ path: [], code: 'unrecognized_keys' }));
    expect(issues[0]!.message).toMatch(/ký tự/);
    expect(JSON.stringify(issues)).not.toContain('bí-mật');
    expect(ValidationErrorDetails.safeParse({ issues }).success).toBe(true);
  });
});
