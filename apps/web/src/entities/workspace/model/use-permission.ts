import {
  hasPermission,
  type MemberGrant,
  type Permission,
  type WorkspaceRole,
} from '@taskflow/contracts/rbac';
import { useCallback } from 'react';

import { useSession } from '@/entities/session/@x/workspace';

import { useWorkspace } from './use-workspace';

const NO_GRANTS: readonly MemberGrant[] = [];

export type PermissionApi = Readonly<{
  /** `null` khi đang tải ⇒ mọi `can()` = false (an toàn: ẩn trước, hiện sau). */
  role: WorkspaceRole | null;
  /** Quyền cấp thêm (ADR-119) — cập nhật realtime qua `member:grants-changed`. */
  grants: readonly MemberGrant[];
  can: (permission: Permission) => boolean;
  viewerId: string | null;
}>;

/**
 * Quyền của tôi trong workspace (frontend.md §5). Quyền hiệu lực = role ∪ grants, tính bằng `hasPermission` của contracts (ADR-080, ADR-119) — FE không
 * giữ bản sao. Chỉ để ẩn/khóa UI; server vẫn kiểm mọi request.
 */
export function usePermission(wsId: string): PermissionApi {
  const workspace = useWorkspace(wsId).data;
  const role = workspace?.myRole ?? null;
  const grants = workspace?.myGrants ?? NO_GRANTS;
  const viewerId = useSession().user?.id ?? null;
  const can = useCallback(
    (permission: Permission) => role !== null && hasPermission(role, grants, permission),
    [role, grants],
  );
  return { role, grants, can, viewerId };
}
