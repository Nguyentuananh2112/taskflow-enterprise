import { describe, expect, it } from 'vitest';

import {
  AdjustLeaveBalanceBody,
  CancelLeaveBody,
  DecideLeaveBody,
  LeaveBalanceParams,
  LeaveBalanceQuery,
  LeaveBalanceRowDto,
  LeavePreviewQuery,
  LeaveRequestDto,
  ListLeaveBalancesQuery,
  ListLeaveRequestsQuery,
  RevokeLeaveBody,
  SubmitLeaveBody,
} from './leave.schemas';

const U1 = '00000000-0000-7000-8000-000000000001';
const span = { type: 'ANNUAL', startDate: '2026-11-23', endDate: '2026-11-24' };

describe('leave — body/query (T-039)', () => {
  it('SubmitLeaveBody: dayPart mặc định FULL; reason tùy chọn, trim, rỗng ⇒ null, ≤ 1000; strict', () => {
    expect(SubmitLeaveBody.parse(span)).toEqual({ ...span, dayPart: 'FULL' });
    expect(SubmitLeaveBody.parse({ ...span, reason: '   ' }).reason).toBeNull();
    expect(SubmitLeaveBody.parse({ ...span, reason: ' ốm ' }).reason).toBe('ốm');
    expect(SubmitLeaveBody.safeParse({ ...span, reason: 'x'.repeat(1001) }).success).toBe(false);
    expect(SubmitLeaveBody.safeParse({ ...span, userId: U1 }).success).toBe(false);
  });

  it('LD-07: end < start ⇒ lỗi ở endDate; AM/PM nhiều ngày ⇒ lỗi ở dayPart; AM một ngày ⇒ được', () => {
    const back = SubmitLeaveBody.safeParse({ ...span, endDate: '2026-11-22' });
    expect(back.error?.issues[0]?.path).toEqual(['endDate']);
    const half = LeavePreviewQuery.safeParse({ ...span, dayPart: 'AM' });
    expect(half.error?.issues[0]?.path).toEqual(['dayPart']);
    expect(LeavePreviewQuery.parse({ ...span, endDate: '2026-11-23', dayPart: 'PM' }).dayPart).toBe(
      'PM',
    );
    expect(LeavePreviewQuery.safeParse({ ...span, reason: 'x' }).success).toBe(false);
  });

  it('ListLeaveRequestsQuery: mine chỉ "1"; status tùy chọn; userId ⇒ 400 (SEC-HR-03); limit 50 mặc định, ≤ 100', () => {
    expect(ListLeaveRequestsQuery.parse({})).toEqual({ limit: 50 });
    expect(ListLeaveRequestsQuery.parse({ mine: '1', status: 'PENDING', limit: '10' })).toEqual({
      mine: '1',
      status: 'PENDING',
      limit: 10,
    });
    expect(ListLeaveRequestsQuery.safeParse({ mine: 'true' }).success).toBe(false);
    expect(ListLeaveRequestsQuery.safeParse({ mine: '1', userId: U1 }).success).toBe(false);
    expect(ListLeaveRequestsQuery.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('approve/reject note tùy chọn (rỗng ⇒ null, ≤ 500); revoke note BẮT BUỘC (LV-20 ⇒ 400); cancel chỉ version', () => {
    expect(DecideLeaveBody.parse({ expectedVersion: 1 })).toEqual({ expectedVersion: 1 });
    expect(DecideLeaveBody.parse({ expectedVersion: 1, note: ' ' }).note).toBeNull();
    expect(DecideLeaveBody.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(RevokeLeaveBody.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(RevokeLeaveBody.safeParse({ expectedVersion: 1, note: '   ' }).success).toBe(false);
    expect(RevokeLeaveBody.safeParse({ expectedVersion: 1, note: 'a\u0000' }).success).toBe(false);
    expect(RevokeLeaveBody.parse({ expectedVersion: 2, note: ' thiếu người ' }).note).toBe(
      'thiếu người',
    );
    expect(CancelLeaveBody.safeParse({ expectedVersion: 1, note: 'x' }).success).toBe(false);
  });

  it('số dư: year 2000–2100 (ép số); adjustmentDays tuyệt đối bước 0,5, được âm, |x| ≤ 999,5', () => {
    expect(LeaveBalanceQuery.parse({ year: '2026' })).toEqual({ year: 2026 });
    expect(LeaveBalanceQuery.safeParse({ year: '1999' }).success).toBe(false);
    expect(ListLeaveBalancesQuery.parse({ year: '2026' })).toEqual({ year: 2026, limit: 50 });
    expect(LeaveBalanceParams.parse({ wsId: U1, userId: U1, year: '2027' }).year).toBe(2027);
    expect(AdjustLeaveBalanceBody.parse({ adjustmentDays: -3.5 })).toEqual({
      adjustmentDays: -3.5,
    });
    expect(AdjustLeaveBalanceBody.safeParse({ adjustmentDays: 0.3 }).success).toBe(false);
    expect(AdjustLeaveBalanceBody.safeParse({ adjustmentDays: 1000 }).success).toBe(false);
    expect(AdjustLeaveBalanceBody.safeParse({ adjustmentDays: '1' }).success).toBe(false);
  });
});

describe('leave — DTO', () => {
  const dto = {
    id: U1,
    userId: U1,
    user: { id: U1, fullName: 'Mia' },
    type: 'ANNUAL',
    startDate: '2026-11-23',
    endDate: '2026-11-24',
    dayPart: 'FULL',
    days: 2,
    status: 'PENDING',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    version: 1,
    createdAt: '2026-11-17T03:00:00.000Z',
    updatedAt: '2026-11-17T03:00:00.000Z',
  };

  it('LeaveRequestDto: reason có thể thiếu hẳn (người khác), null hoặc chuỗi', () => {
    expect(LeaveRequestDto.safeParse(dto).success).toBe(true);
    expect(LeaveRequestDto.safeParse({ ...dto, reason: null }).success).toBe(true);
    expect(LeaveRequestDto.safeParse({ ...dto, days: -1 }).success).toBe(false);
  });

  it('LeaveBalanceRowDto: remaining âm được; used không âm', () => {
    const row = {
      userId: U1,
      user: { id: U1, fullName: 'Mia' },
      year: 2026,
      entitledDays: 12,
      adjustmentDays: -10,
      usedDays: 6,
      pendingDays: 0,
      remainingDays: -4,
    };
    expect(LeaveBalanceRowDto.safeParse(row).success).toBe(true);
    expect(LeaveBalanceRowDto.safeParse({ ...row, usedDays: -1 }).success).toBe(false);
  });
});
