import { roleHasPermission, type Permission, type WorkspaceRole } from '@taskflow/contracts/rbac';
import { useCallback } from 'react';

import { useSession } from '@/entities/session/@x/workspace';

import { useWorkspace } from './use-workspace';

export type PermissionApi = Readonly<{
  /** `null` khi đang tải ⇒ mọi `can()` = false (an toàn: ẩn trước, hiện sau). */
  role: WorkspaceRole | null;
  can: (permission: Permission) => boolean;
  viewerId: string | null;
}>;

/**
 * Quyền của tôi trong WORKSPACE (frontend.md §5) — chỉ quyền dự án theo vai trò (Mốc 3.5 bỏ grants theo workspace;
 * quyền công ty: `useCompanyPermission`). Tính bằng `roleHasPermission` của contracts (ADR-080) — FE không giữ bản
 * sao. Chỉ để ẩn/khóa UI; server vẫn kiểm mọi request.
 */
export function usePermission(wsId: string): PermissionApi {
  const role = useWorkspace(wsId).data?.myRole ?? null;
  const viewerId = useSession().user?.id ?? null;
  const can = useCallback(
    (permission: Permission) => role !== null && roleHasPermission(role, permission),
    [role],
  );
  return { role, can, viewerId };
}
