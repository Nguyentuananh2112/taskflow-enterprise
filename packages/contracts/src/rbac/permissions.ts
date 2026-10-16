import * as z from 'zod';

/**
 * Dữ liệu thuần cho FE ẩn/khóa UI (ADR-080). Nguồn sự thật là RBAC ở domain của API;
 * `apps/api` có test parity bắt buộc so với bảng này. Logic Policy (ownership, LAST_OWNER…)
 * KHÔNG nằm ở đây (data-and-api §5.3).
 */
export const WorkspaceRole = z.enum(['OWNER', 'PM', 'MEMBER', 'VIEWER']);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

/** Hạng role (security.md §3.1): middleware chặn sớm theo role tối thiểu. */
export const ROLE_RANK: Readonly<Record<WorkspaceRole, number>> = Object.freeze({
  OWNER: 4,
  PM: 3,
  MEMBER: 2,
  VIEWER: 1,
});

/** Danh mục permission (security.md §3.2). */
export const Permission = z.enum([
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
  'attendance:self',
  'leave:self',
  'hr:manage',
  'hr:grant',
]);
export type Permission = z.infer<typeof Permission>;

/** ADR-119: quyền cấp thêm theo thành viên. OWNER luôn `[]` (HR ngầm qua role — B-M2). */
export const MemberGrant = z.enum(['HR_MANAGE']);
export type MemberGrant = z.infer<typeof MemberGrant>;

const READ: readonly Permission[] = [
  'workspace:read',
  'member:read',
  'member:leave',
  'project:read',
  'task:read',
  'audit:read',
];
const CONTRIBUTE: readonly Permission[] = [
  'task:create',
  'task:update',
  'task:move',
  'comment:create',
];
const EMPLOYEE: readonly Permission[] = ['attendance:self', 'leave:self'];
const MANAGE: readonly Permission[] = [
  'member:add',
  'member:remove',
  'project:create',
  'project:update',
  'project:archive',
  'task:assign:any',
  'task:delete:any',
];

export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly Permission[]>> =
  Object.freeze({
    OWNER: Object.freeze([
      ...READ,
      ...CONTRIBUTE,
      ...MANAGE,
      'workspace:update',
      'workspace:delete',
      'workspace:restore',
      'member:update-role',
      ...EMPLOYEE,
      'hr:manage',
      'hr:grant',
    ] as const satisfies readonly Permission[]),
    PM: Object.freeze([...READ, ...CONTRIBUTE, ...MANAGE, ...EMPLOYEE]),
    MEMBER: Object.freeze([
      ...READ,
      ...CONTRIBUTE,
      'task:assign:own',
      'task:delete:own',
      ...EMPLOYEE,
    ] as const),
    VIEWER: Object.freeze([...READ]),
  });

/** ADR-119: quyền mỗi grant mở thêm — parity với domain của API. */
export const GRANT_PERMISSIONS: Readonly<Record<MemberGrant, readonly Permission[]>> =
  Object.freeze({
    HR_MANAGE: Object.freeze(['hr:manage'] as const satisfies readonly Permission[]),
  });

/** Quyền hiệu lực = role ∪ grants (ADR-119). Web dùng thay `roleHasPermission` khi có grants. */
export function effectivePermissions(
  role: WorkspaceRole,
  grants: readonly MemberGrant[] = [],
): ReadonlySet<Permission> {
  const out = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const grant of grants) for (const p of GRANT_PERMISSIONS[grant]) out.add(p);
  return out;
}

export function hasPermission(
  role: WorkspaceRole,
  grants: readonly MemberGrant[],
  permission: Permission,
): boolean {
  return effectivePermissions(role, grants).has(permission);
}

/** Tiện ích thuần cho FE: role có permission không. */
export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
