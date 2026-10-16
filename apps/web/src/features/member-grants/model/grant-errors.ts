import * as z from 'zod';

import { memberErrorMessage } from '@/entities/member';
import { isApiError } from '@/shared/api';

// `BusinessRule` của contracts là enum đóng ⇒ đọc `rule` bằng schema cục bộ (web cũ không hỏng khi API thêm luật).
const RuleDetails = z.object({ rule: z.string() });

/** Câu báo lỗi khi cấp/thu "Quản lý nhân sự" (ADR-119). */
export function grantErrorMessage(error: unknown): string {
  if (
    isApiError(error, 'BUSINESS_RULE_VIOLATION') &&
    RuleDetails.safeParse(error.details).data?.rule === 'GRANT_NOT_ALLOWED'
  ) {
    return 'Không cấp quyền này cho Chủ sở hữu hoặc Người xem';
  }
  return memberErrorMessage(error);
}
