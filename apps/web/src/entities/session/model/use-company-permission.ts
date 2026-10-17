import type { CompanyPermission, MeCompanyDto } from '@taskflow/contracts/company';
import { useCallback } from 'react';

import { useMe } from './use-me';

export type CompanyPermissionApi = Readonly<{
  /** `null` khi `/auth/me` chưa về — nơi gọi giữ chỗ (skeleton), không đoán quyền. */
  company: MeCompanyDto | null;
  can: (permission: CompanyPermission) => boolean;
}>;

/**
 * Quyền CẤP CÔNG TY (ADR-135) — đọc `permissions` server đã tính trong `/auth/me`, không tự suy từ role/grants.
 * Đổi quyền ⇒ event `company:access-changed` làm mới `/auth/me` (T-065a) ⇒ menu đổi ngay, không tải lại trang.
 */
export function useCompanyPermission(): CompanyPermissionApi {
  const company = useMe().data?.company ?? null;
  const permissions = company?.permissions;
  const can = useCallback(
    (permission: CompanyPermission) => permissions?.includes(permission) ?? false,
    [permissions],
  );
  return { company, can };
}
