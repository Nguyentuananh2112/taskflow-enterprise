import * as z from 'zod';

import { isApiError } from '@/shared/api';

const Details = z.object({ rule: z.string().optional() });

/** Câu báo lỗi khi chỉnh số phép (D chốt: 403 tự chỉnh, 422 REASON_REQUIRED, 400 năm ngoài ±1, 404). */
export function adjustErrorMessage(error: unknown): string {
  if (
    isApiError(error, 'BUSINESS_RULE_VIOLATION') &&
    Details.safeParse(error.details).data?.rule === 'REASON_REQUIRED'
  ) {
    return 'Tự chỉnh số phép của mình cần ghi lý do.';
  }
  if (isApiError(error, 'FORBIDDEN_ACCESS')) return 'Bạn không có quyền chỉnh số phép này.';
  if (isApiError(error, 'VALIDATION_ERROR')) {
    return 'Không lưu được: số ngày bước 0,5 và chỉ trong năm nay, năm trước hoặc năm sau.';
  }
  if (isApiError(error, 'RESOURCE_NOT_FOUND')) return 'Người này không có dữ liệu trong workspace.';
  return 'Không lưu được. Vui lòng thử lại.';
}
