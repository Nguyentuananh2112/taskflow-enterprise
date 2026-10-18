import * as z from 'zod';

import { DateOnly } from '../common/primitives';

// Mốc 3.5 — vai trò / quyền công ty + khối `/auth/me` (company-level.md ADR-134/135). Tách khỏi
// company.schemas.ts để `auth.schemas` dùng được mà không tạo vòng import auth ⇄ company.

/** ADR-134: vai trò cấp công ty — độc lập với vai trò workspace. Admin KHÔNG phải nhân viên. */
export const CompanyRole = z.enum(['ADMIN', 'EMPLOYEE']);
export type CompanyRole = z.infer<typeof CompanyRole>;

/** Quyền cấp thêm cho EMPLOYEE (Admin đã có ngầm ⇒ không cấp). Thêm grant phải qua ADR. */
export const CompanyGrant = z.enum(['HR_MANAGE', 'PAYROLL_MANAGE']);
export type CompanyGrant = z.infer<typeof CompanyGrant>;

/** ADR-135: quyền công ty — tách khỏi `Permission` của workspace (giao nhau = ∅ sau T-061). */
export const CompanyPermission = z.enum([
  'company:admin',
  'company:grant',
  'hr:manage',
  'payroll:manage',
  'workspace:create',
  'attendance:self',
  'leave:self',
  /** Mốc 5 (ADR-128): xem hồ sơ nhân sự của CHÍNH MÌNH — chỉ EMPLOYEE (Admin không phải nhân viên). */
  'profile:self',
  /** Mốc 4 (ADR-124, TL duyệt 18/10): xem phiếu lương của CHÍNH MÌNH — chỉ EMPLOYEE (Admin không có phiếu ⇒ 403). */
  'payslip:self',
]);
export type CompanyPermission = z.infer<typeof CompanyPermission>;

export const COMPANY_ROLE_PERMISSIONS: Readonly<Record<CompanyRole, readonly CompanyPermission[]>> =
  Object.freeze({
    // Admin quản trị, không chấm công / xin nghỉ ⇒ không có `*:self` (người dùng chốt Q1).
    ADMIN: Object.freeze([
      'company:admin',
      'company:grant',
      'hr:manage',
      'payroll:manage',
      'workspace:create',
    ] as const satisfies readonly CompanyPermission[]),
    EMPLOYEE: Object.freeze([
      'attendance:self',
      'leave:self',
      'profile:self',
      'payslip:self',
      'workspace:create',
    ] as const satisfies readonly CompanyPermission[]),
  });

/** Mỗi grant mở ĐÚNG một quyền; không grant nào chứa `company:*`. */
export const COMPANY_GRANT_PERMISSIONS: Readonly<
  Record<CompanyGrant, readonly CompanyPermission[]>
> = Object.freeze({
  HR_MANAGE: Object.freeze(['hr:manage'] as const satisfies readonly CompanyPermission[]),
  PAYROLL_MANAGE: Object.freeze(['payroll:manage'] as const satisfies readonly CompanyPermission[]),
});

/** Quyền hiệu lực = role ∪ grants. */
export function effectiveCompanyPermissions(
  role: CompanyRole,
  grants: readonly CompanyGrant[] = [],
): ReadonlySet<CompanyPermission> {
  const out = new Set<CompanyPermission>(COMPANY_ROLE_PERMISSIONS[role]);
  for (const grant of grants) for (const p of COMPANY_GRANT_PERMISSIONS[grant]) out.add(p);
  return out;
}

export function hasCompanyPermission(
  role: CompanyRole,
  grants: readonly CompanyGrant[],
  permission: CompanyPermission,
): boolean {
  return effectiveCompanyPermissions(role, grants).has(permission);
}

/** Trạng thái SUY RA (không lưu — ADR-133). */
export const EmployeeStatus = z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'OFFBOARDING', 'LEFT']);
export type EmployeeStatus = z.infer<typeof EmployeeStatus>;

// ---------------------------------------------------------------- /auth/me

/** `/auth/me` thêm `company` (ADR-135). Người đăng nhập được luôn ACTIVE hoặc OFFBOARDING. */
export const MeCompanyDto = z.object({
  /** null khi chưa có dòng `companies` (DB vừa migrate, chưa `admin:bootstrap`). */
  name: z.string().nullable(),
  role: CompanyRole,
  grants: z.array(CompanyGrant),
  permissions: z.array(CompanyPermission),
  status: z.enum(['ACTIVE', 'OFFBOARDING']),
  /** Ngày làm cuối (dải "Bạn làm việc tới hết ngày …"); null nếu không có lịch nghỉ. */
  offboardLastDay: DateOnly.nullable(),
});
export type MeCompanyDto = z.infer<typeof MeCompanyDto>;
