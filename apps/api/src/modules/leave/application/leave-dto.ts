import { halfDaysToDecimal, type LeaveType } from '../domain/leave-balance';
import type { CalendarDate, HalfDays, LeaveDayPart } from '../domain/leave-days';
import type { LeaveStatus } from '../domain/leave-status';
import type { LeaveRequestRecord } from './ports/leave.ports';

export interface LeaveRequestDto {
  id: string;
  userId: string;
  type: LeaveType;
  startDate: CalendarDate;
  endDate: CalendarDate;
  dayPart: LeaveDayPart;
  /** Số ngày TÍNH KHI ĐỌC theo lịch hiện tại (D-H3a), thập phân bước 0,5. */
  days: number;
  status: LeaveStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Chỉ có khi người đọc là người gửi hoặc có `hr:manage` (B-H2) — thiếu hẳn trường, không phải `null`. */
  reason?: string;
}

export function toLeaveDto(
  record: LeaveRequestRecord,
  halfDays: HalfDays,
  opts: { includeReason: boolean },
): LeaveRequestDto {
  return {
    id: record.id,
    userId: record.userId,
    type: record.type,
    startDate: record.startDate,
    endDate: record.endDate,
    dayPart: record.dayPart,
    days: halfDaysToDecimal(halfDays),
    status: record.status,
    decidedBy: record.decidedBy,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    decisionNote: record.decisionNote,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(opts.includeReason ? { reason: record.reason } : {}),
  };
}
