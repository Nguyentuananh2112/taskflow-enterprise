import { UserRefDto } from '@taskflow/contracts/auth';
import { DateOnly, IsoDateTime, Uuid } from '@taskflow/contracts/common';
import { LeaveDayPart, LeaveStatus, LeaveType } from '@taskflow/contracts/hr';
import * as z from 'zod';

// ⚠️ TẠM (T-041b): DTO nghỉ phép theo attendance-leave.md §5 / ADR-122, đề xuất cho D (T-039). Enum đã
// là contracts thật (hr). KHI T-039 có contracts: xóa file, import từ @taskflow/contracts (P5).

export const LeaveRequestDto = z.object({
  id: Uuid,
  userId: Uuid,
  user: UserRefDto,
  type: LeaveType,
  startDate: DateOnly,
  endDate: DateOnly,
  dayPart: LeaveDayPart,
  /** Tính KHI ĐỌC theo lịch + lễ hiện tại (có thể đổi nếu HR thêm ngày lễ) — đừng cache lâu. */
  days: z.number().min(0).multipleOf(0.5),
  reason: z.string(),
  status: LeaveStatus,
  decidedBy: UserRefDto.nullable(),
  decidedAt: IsoDateTime.nullable(),
  decisionNote: z.string().nullable(),
  version: z.int().min(1),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type LeaveRequestDto = z.infer<typeof LeaveRequestDto>;

/** Không bắt buộc nội dung (D đề xuất, chờ TL chốt — ít dữ liệu sức khỏe hơn, B-H2), trim, ≤ 1000. */
export const LeaveReason = z.string().trim().max(1000);

export const CreateLeaveRequestBody = z
  .strictObject({
    type: LeaveType,
    startDate: DateOnly,
    endDate: DateOnly,
    dayPart: LeaveDayPart,
    reason: LeaveReason,
  })
  .refine((b) => b.endDate >= b.startDate, {
    path: ['endDate'],
    message: 'Ngày kết thúc phải sau ngày bắt đầu',
  })
  .refine((b) => b.dayPart === 'FULL' || b.startDate === b.endDate, {
    path: ['dayPart'],
    message: 'Nghỉ nửa ngày chỉ áp dụng cho một ngày',
  });
export type CreateLeaveRequestBody = z.infer<typeof CreateLeaveRequestBody>;

export const CancelLeaveRequestBody = z.strictObject({ expectedVersion: z.int().min(1) });

export const LeaveBalanceDto = z.object({
  year: z.int(),
  entitledDays: z.number(),
  adjustmentDays: z.number(),
  usedDays: z.number(),
  pendingDays: z.number(),
  /** Có thể ÂM (HR giảm điều chỉnh sau khi đã duyệt) — UI hiện số âm, không ép về 0. */
  remainingDays: z.number(),
});
export type LeaveBalanceDto = z.infer<typeof LeaveBalanceDto>;
