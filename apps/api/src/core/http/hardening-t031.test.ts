import { describe, expect, it } from 'vitest';

import { encodeCursor } from './cursor';
import { toAppError } from './error-handler';
import { pathOf } from './middleware';
import { afterFromCursor } from './pagination';

describe('L3 (T-031): lỗi client do thư viện ném ⇒ 4xx, không 500', () => {
  it.each([
    [
      'URIError của router (path không giải mã được)',
      Object.assign(new URIError('x'), { status: 400 }),
      400,
      'VALIDATION_ERROR',
    ],
    [
      'body-parser request.aborted',
      Object.assign(new Error('request aborted'), { status: 400, type: 'request.aborted' }),
      400,
      'VALIDATION_ERROR',
    ],
    [
      'body-parser request.size.invalid',
      Object.assign(new Error('size'), { statusCode: 400, type: 'request.size.invalid' }),
      400,
      'VALIDATION_ERROR',
    ],
    [
      '4xx khác (statusCode 413)',
      Object.assign(new Error('big'), { statusCode: 413 }),
      413,
      'PAYLOAD_TOO_LARGE',
    ],
    [
      '4xx khác (status 415)',
      Object.assign(new Error('enc'), { status: 415 }),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
    [
      '4xx khác (status 404)',
      Object.assign(new Error('nf'), { status: 404 }),
      400,
      'VALIDATION_ERROR',
    ],
  ])('%s', (_label, error, status, code) => {
    const appError = toAppError(error);
    expect([appError.statusCode, appError.code]).toEqual([status, code]);
  });

  it.each([
    ['status 500', { status: 500 }],
    ['status 503', { statusCode: 503 }],
    ['status không phải số', { status: '400' }],
    ['không có status', {}],
  ])('%s ⇒ vẫn là 500 INTERNAL_ERROR', (_label, extra) => {
    expect(toAppError(Object.assign(new Error('boom'), extra)).statusCode).toBe(500);
  });
});

describe('L5 (T-031): access log chỉ ghi path', () => {
  it.each([
    ['/api/v1/workspaces/x/members?q=mia@example.com', '/api/v1/workspaces/x/members'],
    ['/a#frag', '/a'],
    ['/a?b?c', '/a'],
    ['/plain', '/plain'],
    [undefined, ''],
  ])('%s ⇒ %s', (url, path) => {
    expect(pathOf(url)).toBe(path);
  });
});

describe('pagination: `after` trong cursor phải là uuid (gợi ý của B)', () => {
  const ID = '0199e5a2-7c1e-7cc3-9a3b-000000000001';

  it('uuid ⇒ trả lại; không phải uuid ⇒ 400 invalid_cursor', () => {
    expect(afterFromCursor('projects', encodeCursor('projects', { after: ID }))).toBe(ID);
    expect(() => afterFromCursor('projects', encodeCursor('projects', { after: 'x' }))).toThrow(
      expect.objectContaining({ statusCode: 400 }) as Error,
    );
  });
});
