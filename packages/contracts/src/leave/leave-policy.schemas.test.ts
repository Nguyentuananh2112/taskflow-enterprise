import { describe, expect, it } from 'vitest';

import {
  LEAVE_POLICY_DEFAULTS,
  LeaveExportQuery,
  LeavePolicyFields,
  PutLeavePolicyBody,
} from './leave-policy.schemas';

// T-057 (ADR-131): giới hạn = CHECK của migration 9; không thấp hơn mức luật; body strict.

describe('chính sách phép', () => {
  it('mặc định = mức luật và hợp lệ', () => {
    expect(LeavePolicyFields.parse(LEAVE_POLICY_DEFAULTS)).toEqual({
      annualDays: 12,
      seniorityStepYears: 5,
      seniorityBonusDays: 1,
      carryOverEnabled: false,
      carryOverMaxDays: 0,
      carryOverExpiryMonth: 3,
    });
  });

  it('dưới mức luật / ngoài khoảng / không bội 0,5 / thừa trường ⇒ lỗi', () => {
    for (const bad of [
      { annualDays: 11.5 },
      { annualDays: 30.5 },
      { annualDays: 12.3 },
      { seniorityStepYears: 6 },
      { seniorityStepYears: 0 },
      { seniorityStepYears: 2.5 },
      { seniorityBonusDays: 0.5 },
      { carryOverMaxDays: -0.5 },
      { carryOverMaxDays: 30.5 },
      { carryOverExpiryMonth: 0 },
      { carryOverExpiryMonth: 13 },
      { extra: 1 },
    ]) {
      expect(
        LeavePolicyFields.safeParse({ ...LEAVE_POLICY_DEFAULTS, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
    expect(
      LeavePolicyFields.safeParse({
        ...LEAVE_POLICY_DEFAULTS,
        annualDays: 30,
        carryOverMaxDays: 30,
      }).success,
    ).toBe(true);
  });

  it('PUT: expectedVersion 0 (tạo) được, âm thì không; reason tùy chọn', () => {
    const body = { ...LEAVE_POLICY_DEFAULTS, expectedVersion: 0 };
    expect(PutLeavePolicyBody.safeParse(body).success).toBe(true);
    expect(PutLeavePolicyBody.safeParse({ ...body, reason: 'Tăng phép năm' }).success).toBe(true);
    expect(PutLeavePolicyBody.safeParse({ ...body, expectedVersion: -1 }).success).toBe(false);
    expect(PutLeavePolicyBody.safeParse({ annualDays: 14, expectedVersion: 1 }).success).toBe(
      false,
    );
  });
});

describe('báo cáo phép', () => {
  it('from/to mặc định cả năm; phải trong năm; from ≤ to', () => {
    expect(LeaveExportQuery.parse({ year: '2026' })).toEqual({ year: 2026 });
    expect(
      LeaveExportQuery.safeParse({ year: '2026', from: '2026-03-01', to: '2026-03-31' }).success,
    ).toBe(true);
    expect(LeaveExportQuery.safeParse({ year: '2026', from: '2025-12-31' }).success).toBe(false);
    expect(LeaveExportQuery.safeParse({ year: '2026', to: '2027-01-01' }).success).toBe(false);
    expect(
      LeaveExportQuery.safeParse({ year: '2026', from: '2026-04-02', to: '2026-04-01' }).success,
    ).toBe(false);
    expect(LeaveExportQuery.safeParse({ year: '2026', extra: '1' }).success).toBe(false);
  });
});
