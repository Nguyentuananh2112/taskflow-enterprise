import { describe, expect, it } from 'vitest';

import { ApiError, type ApiErrorCode } from '@/shared/api';

import { decideErrorMessage } from './decide-errors';

const err = (status: number, code: ApiErrorCode, details: unknown = null) =>
  new ApiError({ status, code, message: code, details });

describe('decideErrorMessage (mã lỗi D chốt — §9)', () => {
  it.each([
    [err(409, 'VERSION_CONFLICT'), true, /xử lý ở nơi khác/],
    [err(409, 'RESOURCE_CONFLICT', { reason: 'invalid_transition' }), true, /xử lý ở nơi khác/],
    [
      err(409, 'RESOURCE_CONFLICT', { reason: 'requester_not_member' }),
      false,
      /chỉ có thể từ chối/,
    ],
    [err(422, 'BUSINESS_RULE_VIOLATION', { rule: 'INSUFFICIENT_BALANCE' }), false, /đủ ngày phép/],
    [err(422, 'BUSINESS_RULE_VIOLATION', { rule: 'REASON_REQUIRED' }), false, /ghi lý do/],
    [err(403, 'FORBIDDEN_ACCESS'), true, /không còn quyền/],
    [err(404, 'RESOURCE_NOT_FOUND'), true, /không còn tồn tại/],
    [new Error('x'), false, /thử lại/],
  ])('%#', (error, stale, text) => {
    const m = decideErrorMessage(error);
    expect(m.stale).toBe(stale);
    expect(m.text).toMatch(text);
  });
});
