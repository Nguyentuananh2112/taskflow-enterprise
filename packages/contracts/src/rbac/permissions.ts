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
]);
export type Permission = z.infer<typeof Permission>;

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
    ] as const satisfies readonly Permission[]),
    PM: Object.freeze([...READ, ...CONTRIBUTE, ...MANAGE]),
    MEMBER: Object.freeze([...READ, ...CONTRIBUTE, 'task:assign:own', 'task:delete:own'] as const),
    VIEWER: Object.freeze([...READ]),
  });

/** Tiện ích thuần cho FE: role có permission không. */
export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
