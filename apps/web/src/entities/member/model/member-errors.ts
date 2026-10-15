import { BusinessRuleDetails } from '@taskflow/contracts/common';

import { isApiError } from '@/shared/api';

/** Câu báo lỗi cho thao tác thành viên (frontend.md §1.2 — màn Thành viên). */
export function memberErrorMessage(error: unknown): string {
  if (
    isApiError(error, 'BUSINESS_RULE_VIOLATION') &&
    BusinessRuleDetails.safeParse(error.details).data?.rule === 'LAST_OWNER'
  ) {
    return 'Workspace phải còn ít nhất một Chủ sở hữu';
  }
  if (isApiError(error, 'FORBIDDEN_ACCESS')) return 'Bạn không có quyền thực hiện thao tác này';
  if (isApiError(error, 'RESOURCE_NOT_FOUND')) return 'Người này không còn trong workspace';
  return 'Không thực hiện được. Vui lòng thử lại.';
}

/** "Đã xóa. 7 task được bỏ giao" — ADR-044. */
export const unassignedNote = (count: number) =>
  count > 0 ? `${count} task được bỏ giao` : undefined;
