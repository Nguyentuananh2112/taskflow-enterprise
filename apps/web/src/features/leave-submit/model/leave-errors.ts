import * as z from 'zod';

import { daysText } from '@/entities/leave';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';

// Mã lỗi gửi đơn (D chốt, T-039): 422 rule viết HOA, 409 reason viết thường. `BusinessRule` của
// contracts là enum đóng ⇒ đọc lỏng ở đây.
const Rule = z.object({
  rule: z.string(),
  remainingDays: z.number().optional(),
  requestedDays: z.number().optional(),
});
const Reason = z.object({ reason: z.string() });

/** Câu báo lỗi cho người dùng (không lộ mã kỹ thuật) + field gắn lỗi nếu có. */
export function leaveSubmitError(error: unknown): {
  field?: 'endDate' | 'startDate' | 'reason';
  message: string;
} {
  if (isApiError(error, 'BUSINESS_RULE_VIOLATION')) {
    const d = Rule.safeParse(error.details).data;
    // T-075: chưa đồng ý xử lý lý do nghỉ (vd vừa rút lại ở tab khác) ⇒ 422; lý do trống thì gửi được.
    if (d?.rule === 'LEAVE_REASON_CONSENT_REQUIRED') {
      return {
        field: 'reason',
        message:
          'Bạn chưa đồng ý để công ty xử lý lý do nghỉ — xóa lý do để gửi đơn, hoặc bật đồng ý ở trang Quyền riêng tư.',
      };
    }
    if (d?.rule === 'LEAVE_SPANS_YEARS') {
      return {
        field: 'endDate',
        message: 'Đơn không được kéo sang năm sau — hãy tách thành hai đơn.',
      };
    }
    if (d?.rule === 'NO_WORKING_DAYS') {
      return { field: 'startDate', message: 'Khoảng ngày này không có ngày làm việc nào.' };
    }
    if (d?.rule === 'INSUFFICIENT_BALANCE') {
      const left = d.remainingDays === undefined ? '' : ` Còn ${daysText(d.remainingDays)}`;
      const need =
        d.requestedDays === undefined ? '' : `, đơn này cần ${daysText(d.requestedDays)}`;
      return { message: `Không đủ ngày phép năm.${left}${need}.` };
    }
  }
  if (
    isApiError(error, 'RESOURCE_CONFLICT') &&
    Reason.safeParse(error.details).data?.reason === 'overlapping_leave'
  ) {
    return { message: 'Trùng ngày với một đơn đang chờ hoặc đã được duyệt.' };
  }
  return { message: serverErrorMessage(error) };
}
