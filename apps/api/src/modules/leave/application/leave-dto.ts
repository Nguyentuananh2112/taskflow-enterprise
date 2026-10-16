import type { UserRefDto } from '@taskflow/contracts';

import { halfDaysToDecimal, type LeaveType } from '../domain/leave-balance';
import type { CalendarDate, HalfDays, LeaveDayPart } from '../domain/leave-days';
import type { LeaveStatus } from '../domain/leave-status';
import type { LeaveRequestRecord } from './ports/leave.ports';

export interface LeaveRequestDto {
  id: string;
  userId: string;
  user: UserRefDto;
  type: LeaveType;
  startDate: CalendarDate;
  endDate: CalendarDate;
  dayPart: LeaveDayPart;
  /** Số ngày TÍNH KHI ĐỌC theo lịch hiện tại (D-H3a), thập phân bước 0,5. */
  days: number;
  status: LeaveStatus;
  decidedBy: UserRefDto | null;
  decidedAt: string | null;
  decisionNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /**
   * Chỉ có khi người đọc là người gửi hoặc có `hr:manage` (B-H2) — người khác: THIẾU HẲN trường. Lý do tùy chọn
   * (TL, tối thiểu hóa dữ liệu sức khỏe) ⇒ `null` khi người gửi bỏ trống.
   */
  reason?: string | null;
}

export interface LeaveBalanceDto {
  year: number;
  entitledDays: number;
  adjustmentDays: number;
  usedDays: number;
  pendingDays: number;
  /** Có thể âm (Q4: HR giảm số dư sau khi đơn đã duyệt). */
  remainingDays: number;
}

/** Một dòng số dư theo người (HR: `GET leave-balances?year=`, kết quả `PATCH leave-balances/:userId/:year`). */
export interface LeaveBalanceRowDto extends LeaveBalanceDto {
  userId: string;
  user: UserRefDto;
}

/** User đã ẩn danh / không còn bản ghi ⇒ tên thay thế, như UserRefDto của task/audit. */
export const DELETED_USER_NAME = 'Người dùng đã xóa';

export const refOf = (refs: ReadonlyMap<string, UserRefDto>, id: string): UserRefDto =>
  refs.get(id) ?? { id, fullName: DELETED_USER_NAME };

export function toLeaveDto(
  record: LeaveRequestRecord,
  halfDays: HalfDays,
  refs: ReadonlyMap<string, UserRefDto>,
  opts: { includeReason: boolean },
): LeaveRequestDto {
  return {
    id: record.id,
    userId: record.userId,
    user: refOf(refs, record.userId),
    type: record.type,
    startDate: record.startDate,
    endDate: record.endDate,
    dayPart: record.dayPart,
    days: halfDaysToDecimal(halfDays),
    status: record.status,
    decidedBy: record.decidedBy === null ? null : refOf(refs, record.decidedBy),
    decidedAt: record.decidedAt?.toISOString() ?? null,
    decisionNote: record.decisionNote,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(opts.includeReason ? { reason: record.reason } : {}),
  };
}

export function toBalanceDto(
  year: number,
  b: {
    entitled: HalfDays;
    adjustment: HalfDays;
    used: HalfDays;
    pending: HalfDays;
    remaining: HalfDays;
  },
): LeaveBalanceDto {
  return {
    year,
    entitledDays: halfDaysToDecimal(b.entitled),
    adjustmentDays: halfDaysToDecimal(b.adjustment),
    usedDays: halfDaysToDecimal(b.used),
    pendingDays: halfDaysToDecimal(b.pending),
    remainingDays: halfDaysToDecimal(b.remaining),
  };
}
