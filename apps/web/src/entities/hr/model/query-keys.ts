import type { LeaveStatus } from '@taskflow/contracts/hr';

// Dưới gốc ['ws', wsId] (frontend.md §3.2) ⇒ mất quyền workspace (`forgetWorkspace`) dọn luôn; mất
// `hr:manage` ⇒ `useForgetHrWhenRevoked` xóa nhánh 'hr' (không để lại dữ liệu nhạy cảm trong cache).
export const hrKeys = {
  all: (wsId: string) => ['ws', wsId, 'hr'] as const,
  today: (wsId: string) => ['ws', wsId, 'hr', 'today'] as const,
  month: (wsId: string, month: string) => ['ws', wsId, 'hr', 'month', month] as const,
  events: (wsId: string, userId: string, date: string) =>
    ['ws', wsId, 'hr', 'events', userId, date] as const,
  schedules: (wsId: string) => ['ws', wsId, 'hr', 'schedules'] as const,
  holidays: (wsId: string, year: number) => ['ws', wsId, 'hr', 'holidays', year] as const,
  leave: (wsId: string) => ['ws', wsId, 'hr', 'leave'] as const,
  leaveList: (wsId: string, status: LeaveStatus | 'ALL') =>
    ['ws', wsId, 'hr', 'leave', status] as const,
  balances: (wsId: string, year: number) => ['ws', wsId, 'hr', 'balances', year] as const,
};
