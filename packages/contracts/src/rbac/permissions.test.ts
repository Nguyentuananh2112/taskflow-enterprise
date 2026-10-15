import { describe, expect, it } from 'vitest';

import {
  Permission,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  TASK_STATUS_ORDER,
  TASK_STATUS_TRANSITIONS,
  TaskStatus,
  WorkspaceRole,
  roleHasPermission,
} from '../index';

describe('ROLE_PERMISSIONS (security.md §3.2, ADR-080)', () => {
  it('mỗi role chỉ chứa permission hợp lệ và không trùng', () => {
    for (const role of WorkspaceRole.options) {
      const perms = ROLE_PERMISSIONS[role];
      expect(new Set(perms).size).toBe(perms.length);
      for (const p of perms) expect(Permission.safeParse(p).success).toBe(true);
    }
  });

  it('mọi permission đều được ít nhất một role nắm', () => {
    const granted = new Set(WorkspaceRole.options.flatMap((r) => ROLE_PERMISSIONS[r]));
    expect([...granted].sort()).toEqual([...Permission.options].sort());
  });

  it.each([
    ['OWNER', 'workspace:delete', true],
    ['PM', 'workspace:delete', false],
    ['PM', 'member:update-role', false],
    ['PM', 'task:assign:any', true],
    ['MEMBER', 'task:assign:any', false],
    ['MEMBER', 'task:assign:own', true],
    ['MEMBER', 'task:delete:own', true],
    ['MEMBER', 'task:delete:any', false],
    ['VIEWER', 'task:create', false],
    ['VIEWER', 'member:leave', true],
    ['VIEWER', 'audit:read', true],
  ] as const)('%s có %s = %s', (role, perm, expected) => {
    expect(roleHasPermission(role, perm)).toBe(expected);
  });

  it('role hạng cao hơn có tất cả quyền "đọc" của hạng thấp hơn', () => {
    for (const p of ROLE_PERMISSIONS.VIEWER) {
      for (const role of WorkspaceRole.options) expect(roleHasPermission(role, p)).toBe(true);
    }
  });

  it('ROLE_RANK đúng thứ tự và bất biến', () => {
    expect(ROLE_RANK).toEqual({ OWNER: 4, PM: 3, MEMBER: 2, VIEWER: 1 });
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    expect(Object.isFrozen(ROLE_PERMISSIONS.OWNER)).toBe(true);
  });
});

describe('TASK_STATUS_TRANSITIONS (blueprint §3.2)', () => {
  it('đúng 6 cặp chuyển hợp lệ', () => {
    const pairs = TaskStatus.options.flatMap((from) =>
      TASK_STATUS_TRANSITIONS[from].map((to) => `${from}->${to}`),
    );
    expect(pairs.sort()).toEqual(
      [
        'TODO->IN_PROGRESS',
        'IN_PROGRESS->TODO',
        'IN_PROGRESS->REVIEW',
        'REVIEW->IN_PROGRESS',
        'REVIEW->DONE',
        'DONE->REVIEW',
      ].sort(),
    );
  });
  it('thứ tự cột cố định', () => {
    expect(TASK_STATUS_ORDER).toEqual(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
  });
});
