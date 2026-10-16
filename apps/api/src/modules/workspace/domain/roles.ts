// Ma trận quyền chính thức — security.md 3.2. Thuần TS (không import contracts, ADR-043).
// Parity với ROLE_PERMISSIONS của packages/contracts: application/role-permissions-parity.test.ts (ADR-080).

export const WORKSPACE_ROLES = ['OWNER', 'PM', 'MEMBER', 'VIEWER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ALL_PERMISSIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:restore',
  'member:read',
  'member:add',
  'member:update-role',
  'member:remove',
  'member:leave',
  'project:read',
  'project:create',
  'project:update',
  'project:archive',
  'task:read',
  'task:create',
  'task:update',
  'task:move',
  'task:assign:any',
  'task:assign:own',
  'task:delete:any',
  'task:delete:own',
  'audit:read',
  'comment:create',
  // Mốc 3 (ADR-119): chấm công / nghỉ phép của chính mình; quản lý nhân sự; cấp quyền quản lý nhân sự.
  'attendance:self',
  'leave:self',
  'hr:manage',
  'hr:grant',
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

/** ADR-119: quyền cấp thêm theo thành viên (cột `workspace_members.grants`). */
export const MEMBER_GRANTS = ['HR_MANAGE'] as const;
export type MemberGrant = (typeof MEMBER_GRANTS)[number];

/** Permission "cha" dùng cho chặn sớm ở middleware: thỏa nếu role có `:any` HOẶC `:own`. */
export type ParentPermission = 'task:assign' | 'task:delete';

const READ: Permission[] = [
  'workspace:read',
  'member:read',
  'member:leave',
  'project:read',
  'task:read',
  'audit:read',
];
const WRITE_TASKS: Permission[] = ['task:create', 'task:update', 'task:move', 'comment:create'];
/** Nhân viên (chấm công / xin nghỉ): OWNER, PM, MEMBER — VIEWER là khách, không phải nhân viên (§1). */
const EMPLOYEE: Permission[] = ['attendance:self', 'leave:self'];
const MANAGE: Permission[] = [
  'member:add',
  'member:remove',
  'project:create',
  'project:update',
  'project:archive',
  'task:assign:any',
  'task:delete:any',
];

export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, ReadonlySet<Permission>>> = {
  OWNER: new Set([
    ...READ,
    ...WRITE_TASKS,
    ...MANAGE,
    'workspace:update',
    'workspace:delete',
    'workspace:restore',
    'member:update-role',
    ...EMPLOYEE,
    'hr:manage', // OWNER = chủ công ty ⇒ HR ngầm qua role, KHÔNG lưu grant (B-M2)
    'hr:grant',
  ]),
  PM: new Set([...READ, ...WRITE_TASKS, ...MANAGE, ...EMPLOYEE]),
  MEMBER: new Set([...READ, ...WRITE_TASKS, 'task:assign:own', 'task:delete:own', ...EMPLOYEE]),
  VIEWER: new Set(READ),
};

/**
 * ADR-119 / B-M1: grant chỉ mở ĐÚNG các quyền liệt kê ở đây — không bao giờ `hr:grant`, `member:*`,
 * `workspace:*`, `project:*`, `task:*` (test `roles.test.ts` chứng minh loại trừ). Thêm grant mới phải qua ADR.
 */
export const GRANT_PERMISSIONS: Readonly<Record<MemberGrant, ReadonlySet<Permission>>> = {
  HR_MANAGE: new Set<Permission>(['hr:manage']),
};

/** Grant chỉ cấp được cho PM / MEMBER: OWNER đã có qua role, VIEWER không phải nhân viên (422). */
export function canHoldGrants(role: WorkspaceRole): boolean {
  return role === 'PM' || role === 'MEMBER';
}

/** Quyền hiệu lực = quyền của role ∪ quyền của grant (ADR-119). Hàm thuần, không cache. */
export function effectivePermissions(
  role: WorkspaceRole,
  grants: readonly MemberGrant[],
): ReadonlySet<Permission> {
  const out = new Set(ROLE_PERMISSIONS[role]);
  for (const grant of grants) for (const p of GRANT_PERMISSIONS[grant]) out.add(p);
  return out;
}

export function isMemberGrant(value: string): value is MemberGrant {
  return (MEMBER_GRANTS as readonly string[]).includes(value);
}

export function roleAllows(
  role: WorkspaceRole,
  permission: Permission | ParentPermission,
  grants: readonly MemberGrant[] = [],
): boolean {
  const granted = grants.length === 0 ? ROLE_PERMISSIONS[role] : effectivePermissions(role, grants);
  if (permission === 'task:assign' || permission === 'task:delete') {
    return granted.has(`${permission}:any`) || granted.has(`${permission}:own`);
  }
  return granted.has(permission);
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}
