import type { LeaveStatus } from '@taskflow/contracts/hr';

// Mốc 3.5: dưới gốc ['company'] (ADR-139); mất `hr:manage` ⇒ xóa nhánh ['company', 'hr'] (không để lại dữ liệu nhạy
// cảm trong cache); đăng xuất / SESSION_REVOKED ⇒ `queryClient.clear()`.
export const hrKeys = {
  all: () => ['company', 'hr'] as const,
  today: () => ['company', 'hr', 'today'] as const,
  month: (month: string) => ['company', 'hr', 'month', month] as const,
  events: (userId: string, date: string) => ['company', 'hr', 'events', userId, date] as const,
  schedules: () => ['company', 'hr', 'schedules'] as const,
  holidays: (year: number) => ['company', 'hr', 'holidays', year] as const,
  leave: () => ['company', 'hr', 'leave'] as const,
  /** Số đơn chờ (lối tắt trên thẻ Chấm công, T-045) — dưới `leave` ⇒ duyệt / realtime làm mới. */
  leavePendingCount: () => ['company', 'hr', 'leave', 'pending-count'] as const,
  leaveList: (status: LeaveStatus | 'ALL') => ['company', 'hr', 'leave', status] as const,
  balances: (year: number) => ['company', 'hr', 'balances', year] as const,
  policy: (year: number) => ['company', 'hr', 'policy', year] as const,
};
