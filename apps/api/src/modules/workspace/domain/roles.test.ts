import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  isWorkspaceRole,
  roleAllows,
  type Permission,
} from './roles';

// Bảng chính thức: security.md 3.2. Parity với contracts: application/role-permissions-parity.test.ts.
const EXPECTED: Record<Permission, readonly string[]> = {
  'workspace:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'workspace:update': ['OWNER'],
  'workspace:delete': ['OWNER'],
  'workspace:restore': ['OWNER'],
  'member:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'member:add': ['OWNER', 'PM'],
  'member:update-role': ['OWNER'],
  'member:remove': ['OWNER', 'PM'],
  'member:leave': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'project:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'project:create': ['OWNER', 'PM'],
  'project:update': ['OWNER', 'PM'],
  'project:archive': ['OWNER', 'PM'],
  'task:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'task:create': ['OWNER', 'PM', 'MEMBER'],
  'task:update': ['OWNER', 'PM', 'MEMBER'],
  'task:move': ['OWNER', 'PM', 'MEMBER'],
  'task:assign:any': ['OWNER', 'PM'],
  'task:assign:own': ['MEMBER'],
  'task:delete:any': ['OWNER', 'PM'],
  'task:delete:own': ['MEMBER'],
  'audit:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'comment:create': ['OWNER', 'PM', 'MEMBER'],
};

describe('ROLE_PERMISSIONS (security.md 3.2)', () => {
  it('khớp đúng bảng chính thức cho mọi permission × role', () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const permission of ALL_PERMISSIONS) {
      const granted = (['OWNER', 'PM', 'MEMBER', 'VIEWER'] as const).filter((role) =>
        ROLE_PERMISSIONS[role].has(permission),
      );
      expect({ permission, granted }).toEqual({ permission, granted: EXPECTED[permission] });
    }
  });

  it('roleAllows: permission cha "task:delete" thỏa khi role có :any HOẶC :own (chặn sớm ở middleware)', () => {
    expect(roleAllows('MEMBER', 'task:delete')).toBe(true);
    expect(roleAllows('PM', 'task:delete')).toBe(true);
    expect(roleAllows('VIEWER', 'task:delete')).toBe(false);
    expect(roleAllows('MEMBER', 'task:assign')).toBe(true);
    expect(roleAllows('VIEWER', 'task:assign')).toBe(false);
  });

  it('roleAllows với permission cụ thể', () => {
    expect(roleAllows('OWNER', 'workspace:delete')).toBe(true);
    expect(roleAllows('PM', 'workspace:delete')).toBe(false);
    expect(roleAllows('MEMBER', 'task:delete:any')).toBe(false);
  });

  it('isWorkspaceRole', () => {
    expect(['OWNER', 'PM', 'MEMBER', 'VIEWER'].every(isWorkspaceRole)).toBe(true);
    expect(isWorkspaceRole('ADMIN')).toBe(false);
    expect(isWorkspaceRole('owner')).toBe(false);
  });
});

describe('Mốc 3.5 (ADR-134): role workspace chỉ còn quyền dự án', () => {
  it('không có quyền chấm công / nghỉ phép / nhân sự (đã là quyền công ty)', () => {
    for (const p of ['attendance:self', 'leave:self', 'hr:manage', 'hr:grant']) {
      expect((ALL_PERMISSIONS as readonly string[]).includes(p), p).toBe(false);
    }
  });
});
