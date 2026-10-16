import { QueryClientProvider } from '@tanstack/react-query';
import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attendanceApi, attendanceKeys } from '@/entities/attendance';
import { createQueryClient } from '@/shared/query';

import { newCheckKey, useAttendanceCheck } from './use-attendance-check';

// Review H (T-041a #3): chấm xong phải làm mới CẢ lượt chấm hôm nay, không chỉ bảng tháng.

const WS = '3f1b6c1e-8a51-4c84-9a6e-0d9f1d1b2c3d';
afterEach(() => vi.restoreAllMocks());

describe('useAttendanceCheck', () => {
  it('Vào thành công ⇒ ghi cache hôm nay + invalidate bảng tháng VÀ lượt chấm', async () => {
    const today = { date: '2026-10-15', status: 'PRESENT' } as AttendanceTodayDto;
    vi.spyOn(attendanceApi, 'checkIn').mockResolvedValue(today);
    const client = createQueryClient();
    const events = attendanceKeys.myEvents(WS, '2026-10-15');
    const month = attendanceKeys.month(WS, '2026-10');
    client.setQueryData(events, []);
    client.setQueryData(month, { days: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAttendanceCheck(WS), { wrapper });
    await act(() => result.current.mutateAsync({ kind: 'IN', key: newCheckKey() }));
    expect(client.getQueryData(attendanceKeys.today(WS))).toBe(today);
    expect(client.getQueryState(events)?.isInvalidated).toBe(true);
    expect(client.getQueryState(month)?.isInvalidated).toBe(true);
  });
});
