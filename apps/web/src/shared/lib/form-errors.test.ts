import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/api';

import { ROOT_ERROR, applyServerErrors, type SetFieldError } from './form-errors';

type Init = ConstructorParameters<typeof ApiError>[0];
const apiError = (init: Partial<Init> & Pick<Init, 'code'>) =>
  new ApiError({ status: 400, message: 'msg', ...init });

const FIELDS = ['email', 'password'] as const;

describe('applyServerErrors (frontend.md §7.3)', () => {
  it('VALIDATION_ERROR: issue theo path[0] ⇒ field; path lạ ⇒ gộp vào lỗi gốc (không nuốt)', () => {
    const setError = vi.fn<SetFieldError>();
    const details = {
      issues: [
        { path: ['password'], code: 'custom', message: 'Mật khẩu quá phổ biến' },
        { path: ['nickname'], code: 'unrecognized_keys', message: 'Trường lạ' },
      ],
    };
    applyServerErrors(setError, apiError({ code: 'VALIDATION_ERROR', details }), {
      fields: FIELDS,
    });
    expect(setError.mock.calls).toEqual([
      ['password', { type: 'custom', message: 'Mật khẩu quá phổ biến' }],
      [ROOT_ERROR, { type: 'server', message: 'Trường lạ' }],
    ]);
  });

  it('mã gắn cố định vào field (EMAIL_ALREADY_EXISTS → email)', () => {
    const setError = vi.fn<SetFieldError>();
    applyServerErrors(
      setError,
      apiError({ status: 409, code: 'EMAIL_ALREADY_EXISTS', message: 'Email đã được sử dụng.' }),
      { fields: FIELDS, fieldByCode: { EMAIL_ALREADY_EXISTS: 'email' } },
    );
    expect(setError).toHaveBeenCalledWith('email', {
      type: 'EMAIL_ALREADY_EXISTS',
      message: 'Email đã được sử dụng.',
    });
  });

  it('INVALID_CREDENTIALS ⇒ lỗi gốc, không chỉ ra field nào sai', () => {
    const setError = vi.fn<SetFieldError>();
    applyServerErrors(
      setError,
      apiError({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Sai email hoặc mật khẩu.' }),
      { fields: FIELDS },
    );
    expect(setError).toHaveBeenCalledExactlyOnceWith(ROOT_ERROR, {
      type: 'INVALID_CREDENTIALS',
      message: 'Sai email hoặc mật khẩu.',
    });
  });

  it('RATE_LIMITED ⇒ báo số giây chờ', () => {
    const setError = vi.fn<SetFieldError>();
    applyServerErrors(
      setError,
      apiError({ status: 429, code: 'RATE_LIMITED', details: { retryAfterSec: 42 } }),
      { fields: FIELDS },
    );
    expect(setError.mock.calls[0]?.[1].message).toContain('42 giây');
  });

  it.each([
    ['5xx', apiError({ status: 500, code: 'INTERNAL_ERROR', message: 'stack trace…' })],
    ['UNKNOWN_ERROR (ADR-102)', apiError({ status: 422, code: 'UNKNOWN_ERROR', message: 'x' })],
    ['không phải ApiError', new Error('boom')],
  ])('%s ⇒ câu chung, không lộ chi tiết', (_label, error) => {
    const setError = vi.fn<SetFieldError>();
    applyServerErrors(setError, error, { fields: FIELDS });
    expect(setError).toHaveBeenCalledWith(ROOT_ERROR, {
      type: expect.any(String) as string,
      message: 'Có lỗi xảy ra, vui lòng thử lại.',
    });
  });

  it('NETWORK_ERROR ⇒ nhắc kiểm tra mạng', () => {
    const setError = vi.fn<SetFieldError>();
    applyServerErrors(setError, apiError({ status: 0, code: 'NETWORK_ERROR' }), { fields: FIELDS });
    expect(setError.mock.calls[0]?.[1].message).toMatch(/kết nối/);
  });
});

describe('applyServerErrors — RESOURCE_CONFLICT theo details.field (T-034)', () => {
  it('field thuộc form ⇒ lỗi tại field với câu tùy chỉnh', () => {
    const setError = vi.fn();
    const error = new ApiError({
      status: 409,
      code: 'RESOURCE_CONFLICT',
      message: 'x',
      details: { field: 'slug', reason: 'taken' },
    });
    applyServerErrors(setError, error, {
      fields: ['slug'],
      conflictMessages: { slug: 'Trùng slug' },
    });
    expect(setError).toHaveBeenCalledWith('slug', {
      type: 'RESOURCE_CONFLICT',
      message: 'Trùng slug',
    });
  });

  it('field không thuộc form ⇒ lỗi gốc', () => {
    const setError = vi.fn();
    const error = new ApiError({
      status: 409,
      code: 'RESOURCE_CONFLICT',
      message: 'Đã tồn tại',
      details: { field: 'keyPrefix', reason: 'taken' },
    });
    applyServerErrors(setError, error, { fields: ['name'] });
    expect(setError.mock.calls[0]?.[0]).toBe('root.server');
  });
});
