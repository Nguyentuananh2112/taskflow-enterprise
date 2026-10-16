import type { LeaveDayPart, LeaveStatus, LeaveType } from '@taskflow/contracts/hr';

import type { LeaveRequestDto } from '@/shared/api/m3-provisional';

export const LEAVE_TYPE_NAME: Readonly<Record<LeaveType, string>> = {
  ANNUAL: 'Phép năm',
  SICK: 'Nghỉ ốm',
  PERSONAL_PAID: 'Việc riêng có lương',
  UNPAID: 'Không lương',
  OTHER: 'Khác',
};

export const DAY_PART_NAME: Readonly<Record<LeaveDayPart, string>> = {
  FULL: 'Cả ngày',
  AM: 'Buổi sáng',
  PM: 'Buổi chiều',
};

/** Trạng thái đơn: CHỮ + biểu tượng (không chỉ màu). */
export const LEAVE_STATUS: Readonly<
  Record<LeaveStatus, { label: string; icon: string; tone: string }>
> = {
  PENDING: { label: 'Chờ duyệt', icon: '…', tone: 'text-warning' },
  APPROVED: { label: 'Đã duyệt', icon: '✓', tone: 'text-success' },
  REJECTED: { label: 'Bị từ chối', icon: '✕', tone: 'text-danger' },
  CANCELLED: { label: 'Đã hủy', icon: '–', tone: 'text-text-muted' },
  REVOKED: { label: 'Đã thu hồi', icon: '↺', tone: 'text-danger' },
};

const vn = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** "16/11/2026" · "16/11/2026 – 18/11/2026" · "16/11/2026 (buổi sáng)". */
export function leaveRange(r: Pick<LeaveRequestDto, 'startDate' | 'endDate' | 'dayPart'>): string {
  if (r.startDate !== r.endDate) return `${vn(r.startDate)} – ${vn(r.endDate)}`;
  return r.dayPart === 'FULL'
    ? vn(r.startDate)
    : `${vn(r.startDate)} (${DAY_PART_NAME[r.dayPart].toLowerCase()})`;
}

/** "1,5 ngày". */
export const daysText = (days: number) =>
  `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(days)} ngày`;

/**
 * Nhân viên hủy được: PENDING, hoặc APPROVED khi chưa tới ngày bắt đầu (§5). `today` = ngày theo múi
 * giờ của LỊCH (lấy từ server — D-M5), không theo máy. Server vẫn là chốt (409 invalid_transition).
 */
export function canCancel(r: LeaveRequestDto, today: string): boolean {
  return r.status === 'PENDING' || (r.status === 'APPROVED' && r.startDate > today);
}
