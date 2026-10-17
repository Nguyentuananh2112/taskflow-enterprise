import * as z from 'zod';

import { AuthTokenDto, Email, FullName, Password, UserDto } from '../auth/auth.schemas';
import { Cursor, DateOnly, IsoDateTime, limitQuery, searchQuery, Uuid, Version } from '../common';
import { WorkspaceRole } from '../rbac/permissions';
import { CompanyGrant, CompanyRole, EmployeeStatus } from './company-roles';

// Mốc 3.5 — cấp công ty (docs/design/company-level.md, ADR-133…140). Dữ liệu thuần cho FE / harness;
// nguồn sự thật là `company/domain/roles.ts` của API, có test parity (ADR-080).

// ---------------------------------------------------------------- công ty

export const CompanyDto = z.object({ name: z.string(), version: Version });
export type CompanyDto = z.infer<typeof CompanyDto>;

export const UpdateCompanyBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  expectedVersion: Version,
});
export type UpdateCompanyBody = z.infer<typeof UpdateCompanyBody>;

// ---------------------------------------------------------------- nhân viên (hr:manage)

export const EmployeeDto = z.object({
  userId: Uuid,
  fullName: z.string(),
  email: z.string(),
  status: EmployeeStatus,
  grants: z.array(CompanyGrant),
  /** Ngày đầu nhiệm kỳ hiện tại; null với LEFT. */
  startDate: DateOnly.nullable(),
  offboardLastDay: DateOnly.nullable(),
  /** `company_members.version`; null với LEFT (không còn dòng). */
  version: Version.nullable(),
});
export type EmployeeDto = z.infer<typeof EmployeeDto>;

export const ListEmployeesQuery = z.strictObject({
  status: z.enum(['active', 'pending', 'offboarding', 'left']).optional(),
  q: searchQuery(100),
  cursor: Cursor.optional(),
  limit: limitQuery(100, 50),
});
export type ListEmployeesQuery = z.infer<typeof ListEmployeesQuery>;

/** HR không tạo Admin, không cấp grant ⇒ strict (body có `role`/`grants`/`userId` ⇒ 400). */
export const HireEmployeeBody = z.strictObject({
  email: Email,
  fullName: FullName,
  /** Mặc định hôm nay; lùi ≤ 31 ngày, không tương lai (kiểm ở server theo giờ nghiệp vụ). */
  startDate: DateOnly.optional(),
});
export type HireEmployeeBody = z.infer<typeof HireEmployeeBody>;

/**
 * Token / link chỉ xuất hiện MỘT lần (response `Cache-Control: no-store`); không có route đọc lại. `token` cho
 * harness / máy gọi `POST auth/activate`; `link` = `<WEB_ORIGIN>/activate#t=<token>` cho HR sao chép.
 */
export const ActivationDto = z.object({
  token: z.string().min(1),
  link: z.url(),
  expiresAt: IsoDateTime,
});
export type ActivationDto = z.infer<typeof ActivationDto>;

export const HireEmployeeResponse = z.object({
  employee: z.object({
    userId: Uuid,
    status: EmployeeStatus,
    version: Version,
    startDate: DateOnly,
  }),
  /** false = nhận lại người đã nghỉ (tài khoản cũ). */
  accountCreated: z.boolean(),
  /** null khi nhận lại người đã có mật khẩu (đăng nhập bằng mật khẩu cũ, không cần link). */
  activation: ActivationDto.nullable(),
});
export type HireEmployeeResponse = z.infer<typeof HireEmployeeResponse>;

/** `POST hr/employees/:userId/activation-link` — thu hồi link cũ NGAY, cấp link mới. */
export const ReissueActivationResponse = z.object({ activation: ActivationDto });
export type ReissueActivationResponse = z.infer<typeof ReissueActivationResponse>;

export const ScheduleOffboardingBody = z.strictObject({
  /** ∈ [hôm nay − 31, hôm nay + 90] theo giờ nghiệp vụ. */
  lastDay: DateOnly,
  reason: z.string().trim().max(500).optional(),
});
export type ScheduleOffboardingBody = z.infer<typeof ScheduleOffboardingBody>;

export const OffboardingResponse = z.object({
  employee: EmployeeDto,
  warnings: z.object({
    pendingLeaveCount: z.int().min(0),
    /** Workspace mà người này là OWNER duy nhất ⇒ sẽ mồ côi. */
    soleOwnerWorkspaces: z.array(z.object({ id: Uuid, name: z.string() })),
  }),
});
export type OffboardingResponse = z.infer<typeof OffboardingResponse>;

export const EmployeeParams = z.object({ userId: Uuid });
export type EmployeeParams = z.infer<typeof EmployeeParams>;

// ---------------------------------------------------------------- kích hoạt (công khai)

/** Không ràng định dạng chặt: token sai / rác ⇒ CÙNG một 400 `ACTIVATION_INVALID` từ server. */
const ActivationToken = z.string().min(1).max(256);

export const ActivationInspectBody = z.strictObject({ token: ActivationToken });
export type ActivationInspectBody = z.infer<typeof ActivationInspectBody>;

export const ActivationInspectResponse = z.object({
  fullName: z.string(),
  email: z.string(),
  companyName: z.string().nullable(),
});
export type ActivationInspectResponse = z.infer<typeof ActivationInspectResponse>;

export const ActivateBody = z.strictObject({ token: ActivationToken, password: Password });
export type ActivateBody = z.infer<typeof ActivateBody>;

/** Kích hoạt xong ⇒ phiên mới như đăng nhập. */
export const ActivateResponse = AuthTokenDto.extend({ user: UserDto });
export type ActivateResponse = z.infer<typeof ActivateResponse>;

// ---------------------------------------------------------------- quản trị (company:admin)

export const AccessDto = z.object({
  userId: Uuid,
  fullName: z.string(),
  email: z.string(),
  role: CompanyRole,
  grants: z.array(CompanyGrant),
  status: EmployeeStatus,
  version: Version,
});
export type AccessDto = z.infer<typeof AccessDto>;

/** Grant chỉ cho EMPLOYEE (ADMIN + grants ⇒ 422 `GRANT_NOT_ALLOWED`); chỉ Admin khác đổi Admin. */
export const SetAccessBody = z.strictObject({
  role: CompanyRole,
  grants: z.array(CompanyGrant).max(CompanyGrant.options.length),
  expectedVersion: Version,
});
export type SetAccessBody = z.infer<typeof SetAccessBody>;

export const AdminWorkspaceDto = z.object({
  id: Uuid,
  name: z.string(),
  owners: z.array(z.object({ id: Uuid, fullName: z.string() })),
  memberCount: z.int().min(0),
  /** Không còn OWNER (OWNER duy nhất đã nghỉ việc). */
  orphan: z.boolean(),
  deletedAt: IsoDateTime.nullable(),
  archivedAt: IsoDateTime.nullable(),
});
export type AdminWorkspaceDto = z.infer<typeof AdminWorkspaceDto>;

export const AssignWorkspaceOwnerBody = z.strictObject({ userId: Uuid });
export type AssignWorkspaceOwnerBody = z.infer<typeof AssignWorkspaceOwnerBody>;

export const AdminWorkspaceParams = z.object({ id: Uuid });
export type AdminWorkspaceParams = z.infer<typeof AdminWorkspaceParams>;

// ---------------------------------------------------------------- thành viên workspace (member:add)

export const MemberCandidatesQuery = z.strictObject({
  q: z.string().trim().min(2).max(100),
});
export type MemberCandidatesQuery = z.infer<typeof MemberCandidatesQuery>;

export const MemberCandidateDto = z.object({ id: Uuid, fullName: z.string(), email: z.string() });
export type MemberCandidateDto = z.infer<typeof MemberCandidateDto>;

/** = `AddMemberBody` (workspace) — giữ tên cũ cho web đã dựng theo 1bb5f42. */
export const AddMemberByIdBody = z.strictObject({ userId: Uuid, role: WorkspaceRole });
export type AddMemberByIdBody = z.infer<typeof AddMemberByIdBody>;

// ---------------------------------------------------------------- lỗi riêng của mốc

/** `details.reason` 409 (VIẾT THƯỜNG, như `HrConflictReason`). */
export const CompanyConflictReason = z.enum([
  'last_admin',
  'already_employee',
  'workspace_has_owner',
  'workspace_has_members',
  'workspace_deleted',
]);
export type CompanyConflictReason = z.infer<typeof CompanyConflictReason>;

// ---------------------------------------------------------------- realtime

/** `company:access-changed` tới `user:{id}` khi đổi role / grant (thay `member:grants-changed`). */
export const CompanyAccessChangedEvent = z.object({
  role: CompanyRole,
  grants: z.array(CompanyGrant),
});
export type CompanyAccessChangedEvent = z.infer<typeof CompanyAccessChangedEvent>;
