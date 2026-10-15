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
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

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
  ]),
  PM: new Set([...READ, ...WRITE_TASKS, ...MANAGE]),
  MEMBER: new Set([...READ, ...WRITE_TASKS, 'task:assign:own', 'task:delete:own']),
  VIEWER: new Set(READ),
};

export function roleAllows(
  role: WorkspaceRole,
  permission: Permission | ParentPermission,
): boolean {
  const granted = ROLE_PERMISSIONS[role];
  if (permission === 'task:assign' || permission === 'task:delete') {
    return granted.has(`${permission}:any`) || granted.has(`${permission}:own`);
  }
  return granted.has(permission);
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}
