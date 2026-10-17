import * as z from 'zod';

import { UserRefDto } from '../auth/auth.schemas';
import {
  Cursor,
  DateOnly,
  IsoDateTime,
  limitQuery,
  multiLineTextOrNull,
  Uuid,
  Version,
} from '../common/primitives';
import { LeaveDayPart, LeaveStatus, LeaveType } from '../hr/hr.schemas';

// Nghỉ phép (T-039, thiết kế attendance-leave.md §2, §5, §9; hợp đồng web chốt với E/H). Số ngày là thập phân bước
// 0,5 (server đếm bằng số nguyên nửa ngày). Enum lấy từ hr.schemas (B) — không khai báo lại.

const CONTROL_CHARS_EXCEPT_NEWLINE = /[^\P{Cc}\n\r\t]/u;

/** Hình dạng đơn (LD-07): `endDate ≥ startDate`; AM/PM chỉ cho đơn một ngày. Vắt năm ⇒ 422 ở server (LD-08). */
const leaveSpan = <T extends { startDate: string; endDate: string; dayPart: LeaveDayPart }>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (value.endDate < value.startDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.',
    });
  }
  if (value.dayPart !== 'FULL' && value.endDate !== value.startDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['dayPart'],
      message: 'Nghỉ nửa ngày chỉ áp dụng cho đơn một ngày.',
    });
  }
};

const spanFields = {
  type: LeaveType,
  startDate: DateOnly,
  endDate: DateOnly,
  dayPart: LeaveDayPart.default('FULL'),
};

export const LeaveRequestParams = z.object({ requestId: Uuid });
export type LeaveRequestParams = z.infer<typeof LeaveRequestParams>;

/** `POST leave-requests`. `reason` TÙY CHỌN (TL — tối thiểu hóa dữ liệu sức khỏe): trim, ≤ 1000, rỗng ⇒ `null`. */
export const SubmitLeaveBody = z
  .strictObject({ ...spanFields, reason: multiLineTextOrNull(1000).optional() })
  .superRefine(leaveSpan);
export type SubmitLeaveBody = z.infer<typeof SubmitLeaveBody>;

/** `GET leave-requests/preview` — cùng hình dạng như submit, không có `reason`. */
export const LeavePreviewQuery = z.strictObject(spanFields).superRefine(leaveSpan);
export type LeavePreviewQuery = z.infer<typeof LeavePreviewQuery>;

export const LeavePreviewDto = z.object({
  days: z.number().min(0),
  /** Số dư phép năm CÒN trước đơn này (= `remainingDays` của `leave-balances/me`); không phải ANNUAL ⇒ `null`. */
  remainingDays: z.number().nullable(),
});
export type LeavePreviewDto = z.infer<typeof LeavePreviewDto>;

/**
 * `GET leave-requests`: `mine=1` ⇒ đơn của tôi (`leave:self`); không có ⇒ cả công ty (`hr:manage`). Strict ⇒
 * `userId` lạ ⇒ 400 (SEC-HR-03). `status` bỏ trống = mọi trạng thái. Mới nhất trước.
 */
export const ListLeaveRequestsQuery = z.strictObject({
  mine: z.literal('1').optional(),
  status: LeaveStatus.optional(),
  cursor: Cursor.optional(),
  limit: limitQuery(100, 50),
});
export type ListLeaveRequestsQuery = z.infer<typeof ListLeaveRequestsQuery>;

/** approve / reject: ghi chú tùy chọn (≤ 500). OWNER tự xử lý đơn của mình mà rỗng ⇒ 422 `REASON_REQUIRED`. */
export const DecideLeaveBody = z.strictObject({
  expectedVersion: Version,
  note: multiLineTextOrNull(500).optional(),
});
export type DecideLeaveBody = z.infer<typeof DecideLeaveBody>;

/** revoke: lý do BẮT BUỘC (LV-20 — thiếu / rỗng ⇒ 400, TL chốt). */
export const RevokeLeaveBody = z.strictObject({
  expectedVersion: Version,
  note: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((s) => !CONTROL_CHARS_EXCEPT_NEWLINE.test(s), {
      error: 'Không được chứa ký tự điều khiển',
    }),
});
export type RevokeLeaveBody = z.infer<typeof RevokeLeaveBody>;

export const CancelLeaveBody = z.strictObject({ expectedVersion: Version });
export type CancelLeaveBody = z.infer<typeof CancelLeaveBody>;

export const LeaveRequestDto = z.object({
  id: Uuid,
  userId: Uuid,
  user: UserRefDto,
  type: LeaveType,
  startDate: DateOnly,
  endDate: DateOnly,
  dayPart: LeaveDayPart,
  /** Tính khi đọc theo lịch hiện tại (D-H3a). */
  days: z.number().min(0),
  status: LeaveStatus,
  decidedBy: UserRefDto.nullable(),
  decidedAt: IsoDateTime.nullable(),
  decisionNote: z.string().nullable(),
  version: Version,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** Chỉ người gửi + `hr:manage` (B-H2) — người khác: THIẾU HẲN trường. */
  reason: z.string().nullable().optional(),
});
export type LeaveRequestDto = z.infer<typeof LeaveRequestDto>;

// ---------------------------------------------------------------- số dư

const Year = z.coerce.number().int().min(2000).max(2100);

/** `GET leave-balances/me?year=` */
export const LeaveBalanceQuery = z.strictObject({ year: Year });
export type LeaveBalanceQuery = z.infer<typeof LeaveBalanceQuery>;

/** `GET leave-balances?year=` (HR) — mọi nhân viên hiện tại, kể cả chưa có dòng số dư. */
export const ListLeaveBalancesQuery = z.strictObject({
  year: Year,
  cursor: Cursor.optional(),
  limit: limitQuery(100, 50),
});
export type ListLeaveBalancesQuery = z.infer<typeof ListLeaveBalancesQuery>;

export const LeaveBalanceParams = z.object({ userId: Uuid, year: Year });
export type LeaveBalanceParams = z.infer<typeof LeaveBalanceParams>;

/**
 * `PATCH leave-balances/:userId/:year` — `adjustmentDays` là GIÁ TRỊ MỚI tuyệt đối (không phải delta), bước 0,5,
 * được âm (Q4). Cột `Decimal(4,1)` ⇒ |x| ≤ 999,5. OWNER tự chỉnh của mình mà thiếu `note` ⇒ 422 `REASON_REQUIRED`.
 */
export const AdjustLeaveBalanceBody = z.strictObject({
  adjustmentDays: z.number().multipleOf(0.5).min(-999.5).max(999.5),
  note: multiLineTextOrNull(500).optional(),
});
export type AdjustLeaveBalanceBody = z.infer<typeof AdjustLeaveBalanceBody>;

export const LeaveBalanceDto = z.object({
  year: z.int(),
  entitledDays: z.number(),
  adjustmentDays: z.number(),
  usedDays: z.number().min(0),
  pendingDays: z.number().min(0),
  /** Có thể âm (Q4). */
  remainingDays: z.number(),
});
export type LeaveBalanceDto = z.infer<typeof LeaveBalanceDto>;

export const LeaveBalanceRowDto = LeaveBalanceDto.extend({ userId: Uuid, user: UserRefDto });
export type LeaveBalanceRowDto = z.infer<typeof LeaveBalanceRowDto>;
