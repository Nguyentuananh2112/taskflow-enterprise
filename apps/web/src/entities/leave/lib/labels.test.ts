import { describe, expect, it } from 'vitest';

import type { LeaveRequestDto } from '@taskflow/contracts/leave';

import { canCancel, daysText, leaveRange } from './labels';

const base = { startDate: '2026-11-16', endDate: '2026-11-16', dayPart: 'FULL' } as const;

describe('nhãn đơn nghỉ', () => {
  it('leaveRange: một ngày / khoảng / nửa ngày', () => {
    expect(leaveRange(base)).toBe('16/11/2026');
    expect(leaveRange({ ...base, endDate: '2026-11-18' })).toBe('16/11/2026 – 18/11/2026');
    expect(leaveRange({ ...base, dayPart: 'AM' })).toBe('16/11/2026 (buổi sáng)');
  });
  it('daysText: số thập phân kiểu Việt; số âm giữ nguyên', () => {
    expect(daysText(2.5)).toBe('2,5 ngày');
    expect(daysText(-1)).toBe('-1 ngày');
  });
  it('canCancel: PENDING luôn được; APPROVED chỉ khi chưa tới ngày bắt đầu; còn lại không', () => {
    const r = (status: LeaveRequestDto['status']) => ({ ...base, status }) as LeaveRequestDto;
    expect(canCancel(r('PENDING'), '2026-11-20')).toBe(true);
    expect(canCancel(r('APPROVED'), '2026-11-15')).toBe(true);
    expect(canCancel(r('APPROVED'), '2026-11-16')).toBe(false);
    for (const s of ['REJECTED', 'CANCELLED', 'REVOKED'] as const)
      expect(canCancel(r(s), '2026-01-01')).toBe(false);
  });
});
