import type { CalendarDate } from './leave-days';
import { LeaveConflictError } from './leave-errors';

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_ACTIONS = ['approve', 'reject', 'cancel', 'revoke'] as const;
export type LeaveAction = (typeof LEAVE_ACTIONS)[number];

interface Transition {
  readonly to: LeaveStatus;
  /** Chỉ chuyển được khi đơn CHƯA bắt đầu (`startDate` > hôm nay theo múi giờ lịch — D-M5). */
  readonly onlyBeforeStart: boolean;
}

/**
 * Bảng chuyển trạng thái (thiết kế §9, D-H1). Ai được làm (người gửi / `hr:manage` khác người gửi / OWNER) do
 * use case kiểm — domain chỉ biết chuyển nào tồn tại và điều kiện ngày. Đơn đã bắt đầu: v1 không hủy/thu một
 * phần. LV-24: bảng này phải khớp hằng trong `packages/contracts` (parity như ADR-080).
 */
export const LEAVE_TRANSITIONS: Readonly<
  Partial<Record<LeaveStatus, Readonly<Partial<Record<LeaveAction, Transition>>>>>
> = {
  PENDING: {
    approve: { to: 'APPROVED', onlyBeforeStart: false },
    reject: { to: 'REJECTED', onlyBeforeStart: false },
    cancel: { to: 'CANCELLED', onlyBeforeStart: false },
  },
  APPROVED: {
    cancel: { to: 'CANCELLED', onlyBeforeStart: true },
    revoke: { to: 'REVOKED', onlyBeforeStart: true },
  },
};

/** Trạng thái chiếm số dư (PENDING giữ chỗ, APPROVED đã dùng) và chặn chồng ngày. Các trạng thái khác là "đơn chết". */
export function holdsBalance(status: LeaveStatus): boolean {
  return status === 'PENDING' || status === 'APPROVED';
}

/** 409 `invalid_transition` (thiết kế §9) — mọi chuyển không có trong bảng hoặc trái điều kiện ngày. */
export function nextLeaveStatus(
  from: LeaveStatus,
  action: LeaveAction,
  when: { startDate: CalendarDate; today: CalendarDate },
): LeaveStatus {
  const transition = LEAVE_TRANSITIONS[from]?.[action];
  if (!transition || (transition.onlyBeforeStart && when.startDate <= when.today)) {
    throw new LeaveConflictError(
      'invalid_transition',
      { from, action },
      'Không thể thực hiện thao tác này với đơn nghỉ ở trạng thái hiện tại.',
    );
  }
  return transition.to;
}

/**
 * Ngày lịch của thời điểm `now` theo múi giờ IANA của lịch hiệu lực (ADR-120 — server không phụ thuộc múi giờ
 * máy). `en-CA` cho dạng `YYYY-MM-DD`; không thêm thư viện ngày.
 */
export function localDate(now: Date, timeZone: string): CalendarDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
