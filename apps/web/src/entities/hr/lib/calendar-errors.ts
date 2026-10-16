import * as z from 'zod';

import { isApiError } from '@/shared/api';

const Details = z.object({ rule: z.string().optional() });

/** Lỗi lưu lịch / ngày lễ (A chốt: SCHEDULE_IN_PAST, HOLIDAY_IN_PAST, REASON_REQUIRED). */
export function calendarErrorMessage(error: unknown): string {
  const rule = isApiError(error) ? Details.safeParse(error.details).data?.rule : undefined;
  if (rule === 'SCHEDULE_IN_PAST') return 'Lịch mới chỉ áp dụng từ hôm nay trở đi.';
  if (rule === 'HOLIDAY_IN_PAST') return 'Chỉ Chủ sở hữu được sửa ngày lễ đã qua.';
  if (rule === 'REASON_REQUIRED') return 'Sửa ngày lễ đã qua cần ghi lý do.';
  if (isApiError(error, 'FORBIDDEN_ACCESS')) return 'Bạn không có quyền Quản lý nhân sự.';
  if (isApiError(error, 'VALIDATION_ERROR')) return 'Dữ liệu chưa hợp lệ — kiểm tra lại các ô.';
  return 'Không lưu được. Vui lòng thử lại.';
}
