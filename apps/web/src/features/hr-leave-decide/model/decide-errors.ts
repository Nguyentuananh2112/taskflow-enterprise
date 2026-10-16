import * as z from 'zod';

import { isApiError } from '@/shared/api';

// `BusinessRule` của contracts là enum đóng ⇒ đọc `rule` / `reason` bằng schema cục bộ.
const Details = z.object({ rule: z.string().optional(), reason: z.string().optional() });

/** Câu báo lỗi khi HR xử lý đơn (§9 — mã lỗi D chốt). `stale` ⇒ nên tải lại danh sách. */
export function decideErrorMessage(error: unknown): { text: string; stale: boolean } {
  const d = isApiError(error) ? Details.safeParse(error.details).data : undefined;
  if (isApiError(error, 'VERSION_CONFLICT') || d?.reason === 'invalid_transition') {
    return { text: 'Đơn vừa được xử lý ở nơi khác — danh sách đã được tải lại.', stale: true };
  }
  if (d?.reason === 'requester_not_member') {
    return { text: 'Người gửi không còn là nhân viên — chỉ có thể từ chối đơn này.', stale: false };
  }
  if (d?.rule === 'INSUFFICIENT_BALANCE') {
    return { text: 'Người này không còn đủ ngày phép năm cho đơn này.', stale: false };
  }
  if (d?.rule === 'REASON_REQUIRED') {
    return { text: 'Tự xử lý đơn của chính mình cần ghi lý do.', stale: false };
  }
  if (isApiError(error, 'FORBIDDEN_ACCESS')) {
    return {
      text: 'Bạn không còn quyền Quản lý nhân sự hoặc không được tự xử lý đơn này.',
      stale: true,
    };
  }
  if (isApiError(error, 'RESOURCE_NOT_FOUND'))
    return { text: 'Đơn không còn tồn tại.', stale: true };
  return { text: 'Không thực hiện được. Vui lòng thử lại.', stale: false };
}
