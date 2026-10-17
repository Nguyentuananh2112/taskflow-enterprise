// Ma trận quyền CẤP CÔNG TY (company-level.md ADR-134/135). Thuần TS (không import contracts — ADR-043);
// parity với `COMPANY_*` của packages/contracts: application/company-roles-parity.test.ts (ADR-080).

export const COMPANY_ROLES = ['ADMIN', 'EMPLOYEE'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_GRANTS = ['HR_MANAGE', 'PAYROLL_MANAGE'] as const;
export type CompanyGrant = (typeof COMPANY_GRANTS)[number];

export const COMPANY_PERMISSIONS = [
  'company:admin',
  'company:grant',
  'hr:manage',
  'payroll:manage',
  'workspace:create',
  'attendance:self',
  'leave:self',
  'profile:self',
] as const;
export type CompanyPermission = (typeof COMPANY_PERMISSIONS)[number];

/** Admin quản trị, KHÔNG phải nhân viên ⇒ không `*:self` (người dùng chốt Q1). */
export const COMPANY_ROLE_PERMISSIONS: Readonly<Record<CompanyRole, readonly CompanyPermission[]>> =
  {
    ADMIN: ['company:admin', 'company:grant', 'hr:manage', 'payroll:manage', 'workspace:create'],
    EMPLOYEE: ['attendance:self', 'leave:self', 'profile:self', 'workspace:create'],
  };

/** Mỗi grant mở ĐÚNG một quyền; không grant nào mở `company:*`. Thêm grant phải qua ADR. */
export const COMPANY_GRANT_PERMISSIONS: Readonly<
  Record<CompanyGrant, readonly CompanyPermission[]>
> = {
  HR_MANAGE: ['hr:manage'],
  PAYROLL_MANAGE: ['payroll:manage'],
};

/** Grant chỉ cho EMPLOYEE — Admin đã có mọi quyền quản lý (cấp cho Admin ⇒ 422, như B-M2). */
export const canHoldCompanyGrants = (role: CompanyRole): boolean => role === 'EMPLOYEE';

export function effectiveCompanyPermissions(
  role: CompanyRole,
  grants: readonly CompanyGrant[] = [],
): ReadonlySet<CompanyPermission> {
  const out = new Set<CompanyPermission>(COMPANY_ROLE_PERMISSIONS[role]);
  if (canHoldCompanyGrants(role)) {
    for (const grant of grants) for (const p of COMPANY_GRANT_PERMISSIONS[grant]) out.add(p);
  }
  return out;
}

export const isCompanyGrant = (value: string): value is CompanyGrant =>
  (COMPANY_GRANTS as readonly string[]).includes(value);
