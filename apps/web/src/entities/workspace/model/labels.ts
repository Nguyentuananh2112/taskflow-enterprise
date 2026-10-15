import type { WorkspaceRole } from '@taskflow/contracts/rbac';

export const ROLE_LABEL: Readonly<Record<WorkspaceRole, string>> = {
  OWNER: 'Chủ sở hữu',
  PM: 'Quản lý dự án',
  MEMBER: 'Thành viên',
  VIEWER: 'Người xem',
};

/** Role người gọi được phép cấp (security.md §3.2): OWNER cấp bất kỳ, PM chỉ MEMBER/VIEWER. */
export function assignableRoles(actor: WorkspaceRole | null): WorkspaceRole[] {
  if (actor === 'OWNER') return ['OWNER', 'PM', 'MEMBER', 'VIEWER'];
  if (actor === 'PM') return ['MEMBER', 'VIEWER'];
  return [];
}

/** R19: slug trùng và slug dành riêng trả CÙNG một lỗi — không phân biệt cho người dùng. */
export const SLUG_TAKEN = 'Slug đã được dùng hoặc là tên dành riêng.';
