import type { DayStatus } from '@taskflow/contracts/attendance';

/**
 * Trạng thái ngày: CHỮ + biểu tượng (không chỉ màu — WCAG 1.4.1, attendance-leave.md §6). Biểu tượng
 * `aria-hidden`; trình đọc màn hình đọc nhãn.
 */
export const DAY_STATUS: Readonly<
  Record<DayStatus, { label: string; icon: string; tone: string }>
> = {
  // T-047: quá thời hạn lưu (job retention đã / sẽ xóa) — không có số liệu, không phải "vắng".
  RETENTION_EXPIRED: { label: 'Ngoài thời hạn lưu', icon: '⌛', tone: 'text-text-muted' },
  // Trước khi gia nhập / sau khi rời, không có lượt chấm (TL chốt): trung tính, không tính vào tổng.
  NOT_EMPLOYED: { label: 'Chưa/không làm việc', icon: '·', tone: 'text-text-muted' },
  PRESENT: { label: 'Có mặt', icon: '✓', tone: 'text-success' },
  MISSING_OUT: { label: 'Chưa chấm ra', icon: '!', tone: 'text-warning' },
  ABSENT: { label: 'Vắng', icon: '✕', tone: 'text-danger' },
  ON_LEAVE: { label: 'Nghỉ phép', icon: '☾', tone: 'text-primary' },
  HOLIDAY: { label: 'Ngày lễ', icon: '★', tone: 'text-primary' },
  OFF: { label: 'Không phải ngày làm', icon: '–', tone: 'text-text-muted' },
  PENDING: { label: 'Chưa tới giờ', icon: '○', tone: 'text-text-muted' },
};

/**
 * PENDING có hai nghĩa với người dùng (demo TL d9): CHƯA tới giờ vào ca ⇒ "Chưa tới giờ"; đã tới giờ mà chưa chấm vào
 * (`notCheckedInYet`, server tính theo ca hiệu lực) ⇒ "Chưa chấm công". Mọi nơi hiện trạng thái ngày dùng hàm này.
 */
export const NOT_CHECKED_IN = { label: 'Chưa chấm công', icon: '!', tone: 'text-warning' } as const;

export function dayStatusLabel(d: { status: DayStatus; notCheckedInYet: boolean }) {
  return d.status === 'PENDING' && d.notCheckedInYet ? NOT_CHECKED_IN : DAY_STATUS[d.status];
}

export const LEAVE_PART_LABEL = { FULL: 'cả ngày', AM: 'buổi sáng', PM: 'buổi chiều' } as const;
