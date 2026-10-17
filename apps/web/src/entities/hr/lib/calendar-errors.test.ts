import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/api';

import { calendarErrorMessage } from './calendar-errors';

const ruleError = (rule: string) =>
  new ApiError({ status: 422, code: 'BUSINESS_RULE_VIOLATION', message: 'x', details: { rule } });

describe('calendarErrorMessage', () => {
  it('đặt ngày lễ cho ngày quá thời hạn lưu (OUTSIDE_RETENTION) ⇒ câu dễ hiểu', () => {
    expect(calendarErrorMessage(ruleError('OUTSIDE_RETENTION'))).toBe(
      'Ngày này đã quá thời hạn lưu dữ liệu, không thể chỉnh.',
    );
  });

  it('các luật cũ giữ nguyên câu', () => {
    expect(calendarErrorMessage(ruleError('HOLIDAY_IN_PAST'))).toBe(
      'Chỉ Chủ sở hữu được sửa ngày lễ đã qua.',
    );
  });
});
