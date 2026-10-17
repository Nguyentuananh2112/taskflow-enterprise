import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/api';

import { punchErrorMessage } from './use-punch-change';

const ruleError = (rule: string) =>
  new ApiError({ status: 422, code: 'BUSINESS_RULE_VIOLATION', message: 'x', details: { rule } });

describe('punchErrorMessage', () => {
  it('OUTSIDE_RETENTION (T-043b, R27) ⇒ câu dễ hiểu, không mã kỹ thuật', () => {
    expect(punchErrorMessage(ruleError('OUTSIDE_RETENTION'))).toBe(
      'Ngày này đã quá thời hạn lưu dữ liệu, không thể chỉnh.',
    );
  });

  it('các luật cũ giữ nguyên câu', () => {
    expect(punchErrorMessage(ruleError('REASON_REQUIRED'))).toBe('Cần ghi lý do.');
    expect(
      punchErrorMessage(
        new ApiError({
          status: 409,
          code: 'RESOURCE_CONFLICT',
          message: 'x',
          details: { reason: 'already_voided' },
        }),
      ),
    ).toBe('Lượt này đã bị hủy trước đó.');
  });
});
