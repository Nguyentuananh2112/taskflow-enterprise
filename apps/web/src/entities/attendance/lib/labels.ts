import type { DayStatus } from '@taskflow/contracts/attendance';

/**
 * Trạng thái ngày: CHỮ + biểu tượng (không chỉ màu — WCAG 1.4.1, attendance-leave.md §6). Biểu tượng
 * `aria-hidden`; trình đọc màn hình đọc nhãn.
 */
export const DAY_STATUS: Readonly<
  Record<DayStatus, { label: string; icon: string; tone: string }>
> = {
  PRESENT: { label: 'Có mặt', icon: '✓', tone: 'text-success' },
  MISSING_OUT: { label: 'Chưa chấm ra', icon: '!', tone: 'text-warning' },
  ABSENT: { label: 'Vắng', icon: '✕', tone: 'text-danger' },
  ON_LEAVE: { label: 'Nghỉ phép', icon: '☾', tone: 'text-primary' },
  HOLIDAY: { label: 'Ngày lễ', icon: '★', tone: 'text-primary' },
  OFF: { label: 'Không phải ngày làm', icon: '–', tone: 'text-text-muted' },
  PENDING: { label: 'Chưa tới giờ', icon: '○', tone: 'text-text-muted' },
};

export const LEAVE_PART_LABEL = { FULL: 'cả ngày', AM: 'buổi sáng', PM: 'buổi chiều' } as const;
